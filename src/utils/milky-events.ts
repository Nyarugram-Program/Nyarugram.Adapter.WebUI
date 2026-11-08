import type { EventScope } from './milky-event-scope'

export interface EventCursor {
  /** Nyarugram ACK 扩展的恢复代际；SSE 没有该字段时为 0。 */
  epoch: number
  /** 已处理位置，对应 Nyarugram 事件 seq 或 SSE Last-Event-ID。 */
  cursor: number
}

export type EventTransport = 'sse' | 'ws'

export const MAX_EVENTS = 500

const CURSOR_VERSION = 3
const cursorPrefix = `nyarugram.events.v${CURSOR_VERSION}.`
const legacyPrefix = 'nyarugram.events.'

interface StoredEventCursor extends EventCursor {
  version: number
  scope: string
}

const cursorKey = (scope: EventScope) =>
  `${cursorPrefix}${encodeURIComponent(scope.key)}`

export const readEventCursor = (scope: EventScope): EventCursor | undefined => {
  if (!scope.key) return undefined
  try {
    const value = sessionStorage.getItem(cursorKey(scope))
    if (!value) return undefined
    const parsed = JSON.parse(value) as Partial<StoredEventCursor>
    if (
      parsed.version !== CURSOR_VERSION ||
      parsed.scope !== scope.key ||
      typeof parsed.cursor !== 'number' ||
      !Number.isSafeInteger(parsed.cursor)
    ) {
      return undefined
    }
    return {
      cursor: parsed.cursor,
      epoch:
        typeof parsed.epoch === 'number' && Number.isSafeInteger(parsed.epoch)
          ? parsed.epoch
          : 0
    }
  } catch {
    return undefined
  }
}

export const writeEventCursor = (scope: EventScope, cursor: EventCursor) => {
  if (!scope.key) return
  try {
    const value: StoredEventCursor = {
      version: CURSOR_VERSION,
      scope: scope.key,
      epoch: cursor.epoch,
      cursor: cursor.cursor
    }
    sessionStorage.setItem(cursorKey(scope), JSON.stringify(value))
  } catch {
    // 存储配额或隐私模式失败不影响当前连接；内存游标仍然有效。
  }
}

export const clearEventCursor = (scope: EventScope) => {
  if (!scope.key) return
  try {
    sessionStorage.removeItem(cursorKey(scope))
  } catch {
    // 忽略。
  }
}

/**
 * Old v1/v2 keys contain an instance, transport and consumer but no service or
 * account identity. Their ownership cannot be proven, so they are discarded
 * instead of being assigned to the current account.
 */
export const purgeLegacyEventCursors = (instanceId: string) => {
  if (!instanceId) return
  const prefix = `${legacyPrefix}${instanceId}.`
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key && key.startsWith(prefix) && !key.startsWith(cursorPrefix)) {
        keys.push(key)
      }
    }
    keys.forEach((key) => sessionStorage.removeItem(key))
  } catch {
    // 忽略隐私模式下的存储异常。
  }
}

/**
 * 事件入口允许显式填写 http(s) 或 ws(s)。同一个端点在不同传输下只做协议头
 * 规范化，不根据端口或路径推断另一个地址。
 */
export const normalizeEventUrl = (
  raw: string,
  transport: EventTransport
): string => {
  const value = raw.trim()
  if (!value) throw new Error('实例未配置事件入口')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('事件入口不是有效 URL')
  }

  const supported = ['http:', 'https:', 'ws:', 'wss:']
  if (!supported.includes(url.protocol)) {
    throw new Error('事件入口必须使用 http(s) 或 ws(s)')
  }

  if (transport === 'sse') {
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
  } else {
    if (url.protocol === 'http:') url.protocol = 'ws:'
    if (url.protocol === 'https:') url.protocol = 'wss:'
  }

  return url.toString()
}

export const isSameEpoch = (left: number, right: number) => left === right

/**
 * Server consumer ids are limited to 128 characters and are scoped per account
 * by the adapter. The transport suffix keeps SSE and WS recovery positions
 * independent even when the user enters the same consumer name for both.
 */
export const buildServerConsumer = (scope: EventScope) => {
  const suffix = `.${scope.transport}`
  const budget = Math.max(1, 128 - suffix.length)
  return `${scope.consumer.slice(0, budget)}${suffix}`
}

/**
 * Adds the explicit consumer and confirmed account identity without dropping
 * the deployment's path or unrelated query parameters. Only WS puts the token
 * in the URL because the browser WebSocket API has no Authorization header;
 * SSE keeps using the Authorization header.
 */
export const buildEventTransportUrl = (
  scope: EventScope,
  eventUrl: string,
  options: { token?: string; ack?: boolean; cursor?: number } = {}
) => {
  const url = new URL(eventUrl)
  if (options.token) url.searchParams.set('access_token', options.token)
  url.searchParams.set('nyarugram_consumer', buildServerConsumer(scope))
  url.searchParams.set('nyarugram_expected_identity', scope.accountIdentity)
  if (typeof options.cursor === 'number') {
    // A stored v3 local cursor starts the named server consumer at the same
    // position, so a new transport-scoped consumer does not jump to live-only.
    url.searchParams.set('nyarugram_cursor', String(options.cursor))
  }
  if (options.ack) url.searchParams.set('nyarugram_ws_ack', '1')
  return url.toString()
}
