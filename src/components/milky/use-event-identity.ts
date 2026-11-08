import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type EventAccountIdentity,
  adminEventAccount,
  businessEventAccount
} from '@/utils/milky-event-scope'

import MilkyManager, { MilkyRequestError } from '@/controllers/milky_manager'
import NyarugramAdminManager, {
  AdminOperationInvalidatedError,
  AdminRequestError
} from '@/controllers/nyarugram_admin_manager'
import type { AdapterInstance } from '@/types/instance'

export type EventIdentityAccount = EventAccountIdentity

export type EventIdentityState =
  | { status: 'idle' }
  | { status: 'loading'; attempt: number }
  | {
      status: 'error'
      reason: string
      retryable: boolean
      attempt: number
      nextRetryAt?: number
    }
  | { status: 'ready'; account: EventIdentityAccount; token: string }

interface RetryPlan {
  retryable: boolean
  reason: string
  delayMs?: number
}

const SLOW_AUTH_RETRY_MS = 30_000

const backoffMs = (attempt: number) =>
  Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))

const classifyIdentityError = (error: unknown): RetryPlan => {
  if (error instanceof AdminOperationInvalidatedError) {
    return { retryable: false, reason: error.message }
  }

  if (error instanceof AdminRequestError) {
    const reason = error.message
    if (error.network || error.timeout) {
      return { retryable: true, reason, delayMs: error.retryAfterMs }
    }
    if (
      error.status === 408 ||
      error.status === 429 ||
      (typeof error.status === 'number' && error.status >= 500)
    ) {
      return { retryable: true, reason, delayMs: error.retryAfterMs }
    }
    if (error.status === 401 || error.status === 403) {
      // The management session may be re-established in another tab. Retry
      // slowly for identity only; never create an event connection meanwhile.
      return { retryable: true, reason, delayMs: SLOW_AUTH_RETRY_MS }
    }
    return { retryable: false, reason }
  }

  if (error instanceof MilkyRequestError) {
    const reason = error.message
    if (error.network || error.timeout) {
      return { retryable: true, reason, delayMs: error.retryAfterMs }
    }
    if (
      error.status === 408 ||
      error.status === 429 ||
      (typeof error.status === 'number' && error.status >= 500) ||
      error.retcode === -429 ||
      error.retcode === -500 ||
      error.retcode === -503
    ) {
      return { retryable: true, reason, delayMs: error.retryAfterMs }
    }
    if (
      error.status === 401 ||
      error.status === 403 ||
      error.retcode === -403
    ) {
      return { retryable: true, reason, delayMs: SLOW_AUTH_RETRY_MS }
    }
    return { retryable: false, reason }
  }

  return {
    retryable: false,
    reason: error instanceof Error ? error.message : String(error)
  }
}

/**
 * Resolves the service/account identity before any event transport is created.
 * Transient network/5xx/429 failures use bounded backoff and Retry-After; auth
 * or not-logged-in states use a slow identity-only retry (never an event socket).
 */
export function useEventIdentity(input: {
  instance?: AdapterInstance
  generation: number
  token: string
  enabled: boolean
}) {
  const { instance, generation, token, enabled } = input
  const [state, setState] = useState<EventIdentityState>({ status: 'idle' })
  const [nonce, setNonce] = useState(0)
  const attemptRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)
  const contextKeyRef = useRef('')

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const retryNow = useCallback(() => {
    clearTimer()
    attemptRef.current = 0
    setNonce((value) => value + 1)
  }, [clearTimer])

  useEffect(() => {
    if (!enabled || !instance || instance.protocol !== 'milky') {
      setState({ status: 'idle' })
      return
    }

    const contextKey = `${instance.id}|${generation}|${token}`
    if (contextKeyRef.current !== contextKey) {
      contextKeyRef.current = contextKey
      attemptRef.current = 0
    }

    const controller = new AbortController()
    let disposed = false
    const attempt = attemptRef.current
    setState({ status: 'loading', attempt })

    const scheduleRetry = (plan: RetryPlan) => {
      const currentAttempt = attemptRef.current
      const delay = Math.max(1_000, plan.delayMs ?? backoffMs(currentAttempt))
      const nextRetryAt = Date.now() + delay
      setState({
        status: 'error',
        reason: plan.reason,
        retryable: true,
        attempt: currentAttempt,
        nextRetryAt
      })
      attemptRef.current += 1
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        if (!disposed) setNonce((value) => value + 1)
      }, delay)
    }

    const fail = (plan: RetryPlan) => {
      if (plan.retryable) {
        scheduleRetry(plan)
      } else {
        setState({
          status: 'error',
          reason: plan.reason,
          retryable: false,
          attempt: attemptRef.current
        })
      }
    }

    const resolveIdentity = async () => {
      try {
        if (instance.managementKind === 'nyarugram-admin-v1') {
          const account = await NyarugramAdminManager.getAccount(
            instance,
            controller.signal
          )
          if (disposed) return
          const resolved = adminEventAccount(account)
          if ('reason' in resolved) {
            // Not logged in is a valid state that another tab/API can change.
            fail({
              retryable: true,
              reason: resolved.reason,
              delayMs: SLOW_AUTH_RETRY_MS
            })
            return
          }
          attemptRef.current = 0
          setState({ status: 'ready', account: resolved, token })
          return
        }

        if (instance.managementKind === 'none') {
          if (!token.trim()) {
            if (!disposed) {
              setState({
                status: 'error',
                reason:
                  '需要业务访问令牌来确认登录账号；身份未确认前不会复用旧游标。',
                retryable: false,
                attempt: attemptRef.current
              })
            }
            return
          }
          const loginInfo = await MilkyManager.getLoginInfo(
            instance,
            token.trim(),
            controller.signal
          )
          if (disposed) return
          const resolved = businessEventAccount(loginInfo)
          if ('reason' in resolved) {
            fail({
              retryable: true,
              reason: resolved.reason,
              delayMs: SLOW_AUTH_RETRY_MS
            })
            return
          }
          attemptRef.current = 0
          setState({ status: 'ready', account: resolved, token })
          return
        }

        if (!disposed) {
          setState({
            status: 'error',
            reason:
              'NapCat 管理模式没有 Milky 事件账号身份，不能建立可靠的消费作用域。',
            retryable: false,
            attempt: attemptRef.current
          })
        }
      } catch (error) {
        if (disposed || controller.signal.aborted) return
        fail(classifyIdentityError(error))
      }
    }

    resolveIdentity()

    return () => {
      disposed = true
      controller.abort()
      clearTimer()
    }
  }, [instance, generation, token, enabled, nonce, clearTimer])

  return { state, retryNow }
}
