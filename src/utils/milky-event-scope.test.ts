import { describe, expect, it } from 'vitest'

import type { AdapterInstance } from '@/types/instance'

import {
  adminEventAccount,
  buildEventScope,
  businessEventAccount,
  normalizeConsumer
} from './milky-event-scope'

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

const build = (
  instance = makeInstance(),
  transport: 'sse' | 'ws' = 'ws',
  consumer = 'web',
  account = 'admin:account-a'
) =>
  buildEventScope({
    instance,
    transport,
    consumer,
    account: { value: account, label: account }
  })

describe('event scope identity', () => {
  it('is stable for the same service, account, consumer and transport', () => {
    expect(build().key).toBe(build().key)
  })

  it('changes when the account changes', () => {
    expect(build(makeInstance(), 'ws', 'web', 'admin:a').key).not.toBe(
      build(makeInstance(), 'ws', 'web', 'admin:b').key
    )
  })

  it('changes when the service entry changes', () => {
    expect(build(makeInstance()).key).not.toBe(
      build(makeInstance({ eventUrl: 'wss://other.example/event' })).key
    )
    expect(build(makeInstance()).key).not.toBe(
      build(makeInstance({ businessUrl: 'https://other.example' })).key
    )
    expect(build(makeInstance()).key).not.toBe(
      build(makeInstance({ managementUrl: 'https://other.example/admin/v1' }))
        .key
    )
  })

  it('changes when the consumer or transport changes', () => {
    expect(build(makeInstance(), 'ws', 'one').key).not.toBe(
      build(makeInstance(), 'ws', 'two').key
    )
    expect(build(makeInstance(), 'ws').key).not.toBe(
      build(makeInstance(), 'sse').key
    )
  })

  it('normalizes ws/http schemes and ignores URL credentials/query for service identity', () => {
    const ws = build(
      makeInstance({
        managementUrl: 'https://adapter.example/admin/v1',
        businessUrl: 'https://adapter.example',
        eventUrl: 'wss://adapter.example/event'
      })
    )
    const http = build(
      makeInstance({
        managementUrl: 'https://adapter.example/admin/v1',
        businessUrl: 'https://adapter.example',
        eventUrl: 'https://adapter.example/event?access_token=secret'
      })
    )
    expect(ws.key).toBe(http.key)
    expect(ws.serviceIdentity).not.toContain('secret')
  })

  it('defaults an empty consumer consistently', () => {
    expect(normalizeConsumer('   ')).toBe('nyarugram-webui')
    expect(build(makeInstance(), 'ws', '   ').consumer).toBe('nyarugram-webui')
  })
})

describe('event account identity', () => {
  it('uses the stable admin account UUID and rejects inactive accounts', () => {
    expect(
      adminEventAccount({
        account_id: 'uuid-a',
        display_name: 'Bot A',
        numeric_user_id: '100001',
        state: 'active'
      })
    ).toEqual({ value: 'admin:uuid-a', label: 'Bot A (100001)' })

    const inactive = adminEventAccount({
      account_id: 'uuid-a',
      state: 'not_logged_in',
      reason: 'no session'
    })
    expect(inactive).toEqual({ reason: 'no session' })

    expect(adminEventAccount({ state: 'active' })).toEqual({
      reason: '管理接口没有返回稳定的后端账号 ID'
    })
  })

  it('uses the business uin without losing integer precision', () => {
    expect(
      businessEventAccount({ uin: 9007199254740993n, nickname: 'Big' })
    ).toEqual({
      value: 'business:9007199254740993',
      label: 'Big (9007199254740993)'
    })
    expect(businessEventAccount({ uin: '100001' })).toEqual({
      value: 'business:100001',
      label: '100001'
    })
    expect(businessEventAccount({})).toEqual({
      reason: '业务接口没有返回可用的登录账号 uin'
    })
  })
})
