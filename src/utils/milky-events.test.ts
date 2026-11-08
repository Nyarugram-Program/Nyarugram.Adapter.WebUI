import { beforeEach, describe, expect, it } from 'vitest'

import type { AdapterInstance } from '@/types/instance'

import { buildEventScope } from './milky-event-scope'
import {
  buildEventTransportUrl,
  buildServerConsumer,
  clearEventCursor,
  normalizeEventUrl,
  purgeLegacyEventCursors,
  readEventCursor,
  writeEventCursor
} from './milky-events'

const makeInstance = (
  overrides: Partial<AdapterInstance> = {}
): AdapterInstance => ({
  id: 'instance-a',
  name: 'A',
  protocol: 'milky',
  managementKind: 'nyarugram-admin-v1',
  managementUrl: 'https://adapter.example/admin/v1',
  businessUrl: 'https://adapter.example',
  eventUrl: 'wss://adapter.example/event',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
  ...overrides
})

const scope = (
  instance = makeInstance(),
  transport: 'sse' | 'ws' = 'ws',
  account = 'admin:account-a'
) =>
  buildEventScope({
    instance,
    transport,
    consumer: 'web',
    account: { value: account, label: account }
  })

describe('normalizeEventUrl', () => {
  it('uses the same explicit endpoint with the SSE scheme', () => {
    expect(normalizeEventUrl('wss://adapter.example/event', 'sse')).toBe(
      'https://adapter.example/event'
    )
    expect(normalizeEventUrl('ws://127.0.0.1:8080/event', 'sse')).toBe(
      'http://127.0.0.1:8080/event'
    )
  })

  it('uses the same explicit endpoint with the WebSocket scheme', () => {
    expect(normalizeEventUrl('https://adapter.example/event', 'ws')).toBe(
      'wss://adapter.example/event'
    )
    expect(normalizeEventUrl('http://127.0.0.1:8080/event', 'ws')).toBe(
      'ws://127.0.0.1:8080/event'
    )
  })

  it('preserves path and query instead of inferring a different address', () => {
    expect(
      normalizeEventUrl('wss://adapter.example/custom/event?token=x', 'sse')
    ).toBe('https://adapter.example/custom/event?token=x')
  })

  it('rejects empty, malformed and unsupported URLs', () => {
    expect(() => normalizeEventUrl('', 'sse')).toThrow('未配置')
    expect(() => normalizeEventUrl('not-a-url', 'sse')).toThrow('有效 URL')
    expect(() =>
      normalizeEventUrl('ftp://adapter.example/event', 'ws')
    ).toThrow('http(s) 或 ws(s)')
  })
})

describe('event cursor scopes', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('stores cursors per service, account, consumer and transport', () => {
    const base = scope()
    const otherAccount = scope(makeInstance(), 'ws', 'admin:account-b')
    const otherTransport = scope(makeInstance(), 'sse')
    const otherConsumer = buildEventScope({
      instance: makeInstance(),
      transport: 'ws',
      consumer: 'other',
      account: { value: 'admin:account-a', label: 'A' }
    })
    const otherService = scope(
      makeInstance({ eventUrl: 'wss://other.example/event' })
    )

    writeEventCursor(base, { epoch: 3, cursor: 41 })
    writeEventCursor(otherAccount, { epoch: 9, cursor: 99 })

    expect(readEventCursor(base)).toEqual({ epoch: 3, cursor: 41 })
    expect(readEventCursor(otherAccount)).toEqual({ epoch: 9, cursor: 99 })
    expect(readEventCursor(otherTransport)).toBeUndefined()
    expect(readEventCursor(otherConsumer)).toBeUndefined()
    expect(readEventCursor(otherService)).toBeUndefined()
  })

  it('does not reuse a cursor after the management or business entry changes', () => {
    const first = scope()
    writeEventCursor(first, { epoch: 1, cursor: 5 })

    expect(
      readEventCursor(
        scope(makeInstance({ managementUrl: 'https://new.example/admin/v1' }))
      )
    ).toBeUndefined()
    expect(
      readEventCursor(
        scope(makeInstance({ businessUrl: 'https://business2.example' }))
      )
    ).toBeUndefined()
  })

  it('clears only the selected scope', () => {
    const a = scope()
    const b = scope(makeInstance(), 'ws', 'admin:account-b')
    writeEventCursor(a, { epoch: 1, cursor: 5 })
    writeEventCursor(b, { epoch: 2, cursor: 6 })

    clearEventCursor(a)

    expect(readEventCursor(a)).toBeUndefined()
    expect(readEventCursor(b)).toEqual({ epoch: 2, cursor: 6 })
  })

  it('discards legacy cursors without assigning them to an account', () => {
    const legacyKey = 'nyarugram.events.instance-a.ws.web'
    sessionStorage.setItem(legacyKey, JSON.stringify({ epoch: 4, cursor: 88 }))
    const current = scope()
    writeEventCursor(current, { epoch: 1, cursor: 2 })

    purgeLegacyEventCursors('instance-a')

    expect(sessionStorage.getItem(legacyKey)).toBeNull()
    expect(readEventCursor(current)).toEqual({ epoch: 1, cursor: 2 })
  })

  it('ignores corrupt or mismatched storage instead of throwing', () => {
    const current = scope()
    sessionStorage.setItem(
      `nyarugram.events.v3.${encodeURIComponent(current.key)}`,
      '{broken'
    )
    expect(readEventCursor(current)).toBeUndefined()

    sessionStorage.setItem(
      `nyarugram.events.v3.${encodeURIComponent(current.key)}`,
      JSON.stringify({
        version: 3,
        scope: 'different',
        epoch: 1,
        cursor: 2
      })
    )
    expect(readEventCursor(current)).toBeUndefined()
  })
  describe('event transport identity', () => {
    it('adds a stable transport-scoped consumer and expected identity', () => {
      const url = new URL(
        buildEventTransportUrl(
          scope(makeInstance(), 'ws'),
          'wss://adapter.example/custom/event?tenant=one',
          { token: 'token-1', ack: true }
        )
      )

      expect(url.pathname).toBe('/custom/event')
      expect(url.searchParams.get('tenant')).toBe('one')
      expect(url.searchParams.get('nyarugram_consumer')).toBe('web.ws')
      expect(url.searchParams.get('nyarugram_expected_identity')).toBe(
        'admin:account-a'
      )
      expect(url.searchParams.get('access_token')).toBe('token-1')
      expect(url.searchParams.get('nyarugram_ws_ack')).toBe('1')
    })

    it('passes a stored local cursor as the initial server position', () => {
      const url = new URL(
        buildEventTransportUrl(
          scope(makeInstance(), 'ws'),
          'wss://adapter.example/event',
          { cursor: 41 }
        )
      )
      expect(url.searchParams.get('nyarugram_cursor')).toBe('41')
    })

    it('keeps SSE tokens out of the URL and uses the SSE channel consumer', () => {
      const url = new URL(
        buildEventTransportUrl(
          scope(makeInstance(), 'sse'),
          'https://adapter.example/event'
        )
      )

      expect(url.searchParams.get('nyarugram_consumer')).toBe('web.sse')
      expect(url.searchParams.get('access_token')).toBeNull()
      expect(url.searchParams.get('nyarugram_ws_ack')).toBeNull()
    })

    it('truncates long user consumers to the 128 character server limit', () => {
      const long = buildEventScope({
        instance: makeInstance(),
        transport: 'ws',
        consumer: 'x'.repeat(200),
        account: { value: 'admin:account-a', label: 'A' }
      })
      const consumer = buildServerConsumer(long)

      expect(consumer.length).toBeLessThanOrEqual(128)
      expect(consumer.endsWith('.ws')).toBe(true)
    })
  })
})
