import axios, { type AxiosRequestConfig } from 'axios'
import { EventSourcePolyfill } from 'event-source-polyfill'

import type {
  AdminAccount,
  AdminConfig,
  AdminConfigSaveRequest,
  AdminConfigSchema,
  AdminConfigStatus,
  AdminInfo,
  AdminLogEntry,
  AdminLogPage,
  AdminMetrics,
  AdminSessionState
} from '@/types/admin'
import type { AdapterInstance } from '@/types/instance'

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

const isWriteMethod = (method: string) =>
  !['get', 'head', 'options'].includes(method.toLowerCase())

const isCancelError = (error: unknown) => {
  if (axios.isAxiosError(error)) return error.code === 'ERR_CANCELED'
  return error instanceof Error && error.name === 'AbortError'
}

const raceWithSignal = <T>(promise: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })

export type AdminInvalidationReason = 'operation_superseded' | 'session_changed'

/**
 * A write was started in a management session that no longer exists, or the
 * instance/entry changed while it was waiting. `sent` distinguishes a request
 * that never left the browser from one whose server-side result may be unknown.
 */
export class AdminOperationInvalidatedError extends Error {
  reason: AdminInvalidationReason
  sent: boolean
  instanceId: string

  constructor(
    reason: AdminInvalidationReason,
    sent: boolean,
    instanceId: string
  ) {
    super(
      reason === 'session_changed'
        ? sent
          ? '管理会话已在请求期间切换；旧请求未在新会话重试，服务端结果可能已生效，不能视为当前会话成功。'
          : '管理会话已在请求期间切换；旧操作已失效，未发送到新会话。'
        : sent
          ? '实例或管理入口已切换；请求已发送，服务端结果可能已生效，不能视为当前会话成功。'
          : '实例或管理入口已切换；操作已失效，请求未发送。'
    )
    this.name = 'AdminOperationInvalidatedError'
    this.reason = reason
    this.sent = sent
    this.instanceId = instanceId
  }
}

export class AdminRequestError extends Error {
  status?: number
  code?: string
  requestId?: string
  fields?: Record<string, string>
  network: boolean
  timeout: boolean
  retryAfterMs?: number

  constructor(
    message: string,
    options: {
      status?: number
      code?: string
      requestId?: string
      fields?: Record<string, string>
      network?: boolean
      timeout?: boolean
      retryAfterMs?: number
    } = {}
  ) {
    super(message)
    this.name = 'AdminRequestError'
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
    this.fields = options.fields
    this.network = options.network ?? false
    this.timeout = options.timeout ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

const parseRetryAfter = (headers: unknown): number | undefined => {
  if (!headers || typeof headers !== 'object') return undefined
  const raw = (headers as Record<string, unknown>)['retry-after']
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

const toAdminError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const data = error.response?.data as
      | {
          error?: {
            code?: string
            message?: string
            request_id?: string
            fields?: Record<string, string>
          }
          message?: string
        }
      | undefined
    const message = data?.error?.message ?? data?.message ?? error.message
    return new AdminRequestError(
      status ? `HTTP ${status}：${message}` : message,
      {
        status,
        code: data?.error?.code,
        requestId: data?.error?.request_id,
        fields: data?.error?.fields,
        network: !error.response,
        timeout: error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT',
        retryAfterMs: parseRetryAfter(error.response?.headers)
      }
    )
  }
  return error instanceof Error
    ? new AdminRequestError(error.message)
    : new AdminRequestError(String(error))
}

interface SessionEntry {
  baseUrl: string
  generation: number
  csrfToken?: string
  sessionId?: string
  expiresAt?: string
  pending?: Promise<AdminSessionState | null>
  pendingGeneration?: number
  abort?: AbortController
}

interface OperationContext {
  instanceId: string
  baseUrl: string
  generation: number
  sessionId?: string
  csrfToken?: string
}

const sessionHeader = 'x-nyarugram-admin-session'

const headerValue = (headers: unknown, name: string): string | undefined => {
  if (!headers || typeof headers !== 'object') return undefined
  const value = (headers as Record<string, unknown>)[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export default class NyarugramAdminManager {
  private static sessions = new Map<string, SessionEntry>()

  private static capture(instance: AdapterInstance): OperationContext {
    const baseUrl = normalizeBaseUrl(instance.managementUrl)
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new AdminRequestError('实例未配置有效的 /admin/v1 管理地址')
    }

    let entry = this.sessions.get(instance.id)
    if (!entry || entry.baseUrl !== baseUrl) {
      entry?.abort?.abort()
      entry = {
        baseUrl,
        generation: (entry?.generation ?? 0) + 1
      }
      this.sessions.set(instance.id, entry)
    }

    return {
      instanceId: instance.id,
      baseUrl: entry.baseUrl,
      generation: entry.generation,
      sessionId: entry.sessionId,
      csrfToken: entry.csrfToken
    }
  }

  private static isCurrent(context: OperationContext) {
    const entry = this.sessions.get(context.instanceId)
    return (
      !!entry &&
      entry.baseUrl === context.baseUrl &&
      entry.generation === context.generation
    )
  }

  private static invalidated(
    context: OperationContext,
    reason: AdminInvalidationReason,
    sent: boolean
  ) {
    return new AdminOperationInvalidatedError(reason, sent, context.instanceId)
  }

  /**
   * Instance switch, management-URL change, login, logout or a rejected session
   * all bump this generation. Anything captured before the bump is stale.
   */
  public static invalidateSession(instanceId: string) {
    const entry = this.sessions.get(instanceId)
    if (!entry) return
    entry.abort?.abort()
    entry.generation += 1
    entry.csrfToken = undefined
    entry.sessionId = undefined
    entry.expiresAt = undefined
    entry.pending = undefined
    entry.pendingGeneration = undefined
    entry.abort = undefined
  }

  private static invalidateIfCurrent(context: OperationContext) {
    if (!this.isCurrent(context)) return
    this.invalidateSession(context.instanceId)
  }

  /** Test-only reset; production code invalidates on lifecycle changes. */
  public static clearSessionCacheForTests() {
    for (const entry of this.sessions.values()) entry.abort?.abort()
    this.sessions.clear()
  }

  private static startSessionFetch(
    context: OperationContext,
    entry: SessionEntry
  ) {
    const generation = context.generation
    const baseUrl = context.baseUrl
    const controller = new AbortController()
    entry.abort?.abort()
    entry.abort = controller

    let promise: Promise<AdminSessionState | null>
    promise = axios
      .request<{ data?: AdminSessionState }>({
        baseURL: baseUrl,
        url: '/session',
        method: 'GET',
        withCredentials: true,
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      .then((response) => {
        const session = response.data.data ?? null
        if (entry.baseUrl === baseUrl && entry.generation === generation) {
          entry.csrfToken = session?.csrf_token || undefined
          entry.sessionId = session?.session_id || undefined
          entry.expiresAt = session?.expires_at
        }
        return session
      })
      .catch((error) => {
        if (isCancelError(error)) throw error
        const adminError = toAdminError(error)
        if (adminError.status === 401) {
          if (entry.baseUrl === baseUrl && entry.generation === generation) {
            // No session exists. Bump the generation so anything captured
            // before this response cannot acquire a later session's CSRF.
            entry.generation += 1
            entry.csrfToken = undefined
            entry.sessionId = undefined
            entry.expiresAt = undefined
          }
          return null
        }
        throw adminError
      })
      .finally(() => {
        if (entry.pending === promise) {
          entry.pending = undefined
          entry.pendingGeneration = undefined
        }
        if (entry.abort === controller) entry.abort = undefined
      })

    entry.pending = promise
    entry.pendingGeneration = generation
    return promise
  }

  private static fetchSession(
    context: OperationContext,
    signal?: AbortSignal
  ): Promise<AdminSessionState | null> {
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', false)
    }
    const entry = this.sessions.get(context.instanceId)!
    const pending =
      entry.pending && entry.pendingGeneration === context.generation
        ? entry.pending
        : this.startSessionFetch(context, entry)
    return signal ? raceWithSignal(pending, signal) : pending
  }

  private static async ensureWriteContext(context: OperationContext) {
    if (context.csrfToken) return context

    let session: AdminSessionState | null
    try {
      session = await this.fetchSession(context)
    } catch (error) {
      if (isCancelError(error)) {
        throw this.invalidated(context, 'operation_superseded', false)
      }
      throw error
    }

    if (!session?.csrf_token) {
      throw new AdminRequestError('管理会话未建立或已失效', { status: 401 })
    }
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', false)
    }
    if (
      context.sessionId &&
      session.session_id &&
      session.session_id !== context.sessionId
    ) {
      // The cookie now belongs to a different management session. Do not turn
      // an operation started before that login into a new-session write.
      throw this.invalidated(context, 'session_changed', false)
    }

    return {
      ...context,
      csrfToken: session.csrf_token,
      sessionId: session.session_id ?? context.sessionId
    }
  }

  private static async refreshCsrf(context: OperationContext) {
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', true)
    }
    // Clear only the token; keep the generation and session id so this is a
    // CSRF refresh inside one operation, not a new login generation.
    const entry = this.sessions.get(context.instanceId)!
    entry.csrfToken = undefined

    let session: AdminSessionState | null
    try {
      session = await this.fetchSession(context)
    } catch (error) {
      if (isCancelError(error)) {
        throw this.invalidated(context, 'operation_superseded', true)
      }
      throw error
    }

    if (!session?.csrf_token) {
      throw new AdminRequestError('管理会话未建立或已失效', { status: 401 })
    }
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', true)
    }
    if (
      context.sessionId &&
      session.session_id &&
      session.session_id !== context.sessionId
    ) {
      throw this.invalidated(context, 'session_changed', true)
    }

    return {
      ...context,
      csrfToken: session.csrf_token,
      sessionId: session.session_id ?? context.sessionId
    }
  }

  private static config(
    context: OperationContext,
    method: string,
    config: AxiosRequestConfig = {}
  ): AxiosRequestConfig {
    const isWrite = isWriteMethod(method)
    return {
      ...config,
      baseURL: context.baseUrl,
      method,
      withCredentials: true,
      headers: {
        Accept: 'application/json',
        ...(isWrite && context.csrfToken
          ? { 'X-CSRF-Token': context.csrfToken }
          : {}),
        ...config.headers
      }
    }
  }

  private static async send(
    context: OperationContext,
    method: string,
    url: string,
    data?: unknown,
    config: AxiosRequestConfig = {}
  ) {
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', false)
    }
    const response = await axios.request<{ data?: unknown }>(
      this.config(context, method, { url, data, ...config })
    )

    const responseSession = headerValue(response.headers, sessionHeader)
    if (
      context.sessionId &&
      responseSession &&
      responseSession !== context.sessionId
    ) {
      throw this.invalidated(context, 'session_changed', true)
    }
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', true)
    }

    // A read can reveal the current session id before the first write. It is
    // safe to remember it only when the entry is still the same generation.
    if (!context.sessionId && responseSession) {
      const entry = this.sessions.get(context.instanceId)
      if (entry && entry.generation === context.generation) {
        entry.sessionId = responseSession
      }
    }

    return response
  }

  private static async execute<T>(
    instance: AdapterInstance,
    method: string,
    url: string,
    data?: unknown,
    config: AxiosRequestConfig = {},
    allowCsrfRetry = true
  ): Promise<{ data: T; context: OperationContext }> {
    const write = isWriteMethod(method)
    let context = this.capture(instance)
    if (write) context = await this.ensureWriteContext(context)

    try {
      const response = await this.send(context, method, url, data, config)
      return { data: response.data.data as T, context }
    } catch (error) {
      if (error instanceof AdminOperationInvalidatedError) throw error
      const adminError = toAdminError(error)

      if (adminError.status === 401 && url !== '/account/login') {
        // A 401 from /account/login is a backend credential failure, not an
        // invalid management session; keep the management CSRF cache intact.
        this.invalidateIfCurrent(context)
        throw adminError
      }

      if (
        write &&
        adminError.status === 403 &&
        adminError.code === 'csrf_rejected'
      ) {
        if (!allowCsrfRetry) throw adminError
        // refreshCsrf keeps the operation's generation/session identity. If a
        // login, logout or entry change happened, it throws instead of
        // acquiring the new session's permission.
        const refreshed = await this.refreshCsrf(context)
        try {
          const response = await this.send(refreshed, method, url, data, config)
          return { data: response.data.data as T, context: refreshed }
        } catch (retryError) {
          if (retryError instanceof AdminOperationInvalidatedError) {
            throw retryError
          }
          const retryAdminError = toAdminError(retryError)
          if (retryAdminError.status === 401) {
            this.invalidateIfCurrent(refreshed)
          }
          throw retryAdminError
        }
      }

      throw adminError
    }
  }

  private static async request<T>(
    instance: AdapterInstance,
    method: string,
    url: string,
    data?: unknown,
    config: AxiosRequestConfig = {}
  ): Promise<T> {
    const result = await this.execute<T>(instance, method, url, data, config)
    return result.data
  }

  public static async getSession(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    const context = this.capture(instance)
    let session: AdminSessionState | null
    try {
      session = await this.fetchSession(context, signal)
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        return null
      }
      throw error
    }
    if (session === null) return null
    if (!this.isCurrent(context)) {
      throw this.invalidated(context, 'operation_superseded', false)
    }
    return session
  }

  public static async login(
    instance: AdapterInstance,
    username: string,
    password: string
  ) {
    // A login starts a new session generation. Anything captured before this
    // point can no longer execute or retry against the new session.
    this.invalidateSession(instance.id)
    const context = this.capture(instance)

    try {
      const response = await axios.request<{ data?: AdminSessionState }>({
        baseURL: context.baseUrl,
        url: '/session',
        method: 'POST',
        data: { username, password },
        withCredentials: true,
        headers: { Accept: 'application/json' }
      })
      const session = response.data.data ?? null
      if (!this.isCurrent(context)) {
        throw this.invalidated(context, 'operation_superseded', true)
      }
      const entry = this.sessions.get(context.instanceId)!
      entry.csrfToken = session?.csrf_token || undefined
      entry.sessionId = session?.session_id || undefined
      entry.expiresAt = session?.expires_at
      return session ?? { authenticated: false }
    } catch (error) {
      if (error instanceof AdminOperationInvalidatedError) throw error
      throw toAdminError(error)
    }
  }

  public static async logout(instance: AdapterInstance) {
    const initial = this.capture(instance)
    try {
      const result = await this.execute(instance, 'DELETE', '/session')
      if (this.isCurrent(result.context)) {
        this.invalidateSession(instance.id)
      }
      return result.data
    } catch (error) {
      if (error instanceof AdminOperationInvalidatedError) throw error
      // A network or server failure leaves the outcome unknown; clear only
      // the generation this attempt started from.
      this.invalidateIfCurrent(initial)
      throw error
    }
  }

  public static async getInfo(instance: AdapterInstance, signal?: AbortSignal) {
    return this.request<AdminInfo>(instance, 'GET', '/info', undefined, {
      signal
    })
  }

  public static async getHealth(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    return this.request<Record<string, unknown>>(
      instance,
      'GET',
      '/health',
      undefined,
      { signal }
    )
  }

  public static async getAccount(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    return this.request<AdminAccount>(instance, 'GET', '/account', undefined, {
      signal
    })
  }

  public static async loginAccount(
    instance: AdapterInstance,
    username: string,
    password: string,
    totpCode = ''
  ) {
    return this.request<AdminAccount>(instance, 'POST', '/account/login', {
      username,
      password,
      ...(totpCode ? { totp_code: totpCode } : {})
    })
  }

  public static async logoutAccount(instance: AdapterInstance) {
    return this.request<Record<string, never>>(
      instance,
      'POST',
      '/account/logout'
    )
  }

  public static async getConfigSchema(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    return this.request<AdminConfigSchema>(
      instance,
      'GET',
      '/config/schema',
      undefined,
      { signal }
    )
  }

  public static async getConfig(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    return this.request<AdminConfig>(instance, 'GET', '/config', undefined, {
      signal
    })
  }

  public static async validateConfig(
    instance: AdapterInstance,
    config: AdminConfigSaveRequest
  ) {
    return this.request<{
      valid: boolean
      errors?: Record<string, string>
    }>(instance, 'POST', '/config/validate', config)
  }

  public static async saveConfig(
    instance: AdapterInstance,
    config: AdminConfigSaveRequest,
    version: string
  ) {
    return this.request<AdminConfig>(instance, 'PUT', '/config', config, {
      headers: { 'If-Match': version }
    })
  }

  public static async getConfigStatus(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    return this.request<AdminConfigStatus>(
      instance,
      'GET',
      '/config/status',
      undefined,
      { signal }
    )
  }

  public static async getMetrics(
    instance: AdapterInstance,
    signal?: AbortSignal
  ) {
    return this.request<AdminMetrics>(instance, 'GET', '/metrics', undefined, {
      signal
    })
  }

  public static async getLogs(
    instance: AdapterInstance,
    options: { cursor?: string; level?: string; limit?: number } = {},
    signal?: AbortSignal
  ) {
    const params: Record<string, string | number> = {}
    if (options.cursor) params.cursor = options.cursor
    if (options.level) params.level = options.level
    if (options.limit) params.limit = options.limit
    return this.request<AdminLogPage>(instance, 'GET', '/logs', undefined, {
      params,
      signal
    })
  }

  public static getLogsStream(
    instance: AdapterInstance,
    options: {
      level?: string
      onEntry: (entry: AdminLogEntry) => void
      onError?: (error: unknown) => void
    }
  ) {
    const baseURL = normalizeBaseUrl(instance.managementUrl)
    const query = options.level
      ? `?level=${encodeURIComponent(options.level)}`
      : ''
    const eventSource = new EventSourcePolyfill(
      `${baseURL}/logs/stream${query}`,
      {
        withCredentials: true,
        headers: {
          Accept: 'text/event-stream'
        }
      }
    )

    const handleData = (payload: string) => {
      try {
        const parsed = JSON.parse(payload) as AdminLogEntry
        if (parsed && typeof parsed.id === 'string') options.onEntry(parsed)
      } catch (error) {
        console.error('管理日志解析失败', error)
      }
    }

    eventSource.onmessage = (event) => handleData(event.data)
    eventSource.addEventListener('log', (event) =>
      handleData((event as MessageEvent).data)
    )
    eventSource.onerror = (error) => options.onError?.(error)

    return eventSource
  }
}
