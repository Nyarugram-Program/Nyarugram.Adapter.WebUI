import { beforeEach, describe, expect, it } from 'vitest'

import {
  instancesStorageKey,
  migrateStoredInstanceState,
  purgeRetiredNapcatState,
  readPersistedInstanceState
} from './instance-storage'

const NOW = '2026-11-08T12:00:00.000Z'
const LATER = '2026-11-09T12:00:00.000Z'
const CREATED = '2026-11-01T00:00:00.000Z'

const napcatInstance = (overrides: Record<string, unknown> = {}) => ({
  id: 'legacy-napcat',
  name: '旧 NapCat',
  protocol: 'onebot11',
  managementKind: 'napcat',
  managementUrl: 'http://127.0.0.1:6099',
  businessUrl: 'https://onebot.example/',
  eventUrl: '',
  createdAt: CREATED,
  updatedAt: CREATED,
  ...overrides
})

const adminInstance = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 'milky-admin',
  name: 'Milky 管理',
  protocol: 'milky',
  managementKind: 'nyarugram-admin-v1',
  managementUrl: 'https://adapter.example/admin/v1',
  businessUrl: 'https://adapter.example',
  eventUrl: 'wss://adapter.example/event',
  createdAt: CREATED,
  updatedAt: CREATED,
  ...overrides
})

const stored = (instances: unknown[], activeId = '') =>
  JSON.stringify({ instances, activeId })

describe('legacy instance storage migration', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('migrates a NapCat management instance to OneBot V11 protocol-only', () => {
    const state = migrateStoredInstanceState(
      stored([napcatInstance()], 'legacy-napcat'),
      NOW
    )

    expect(state.instances).toEqual([
      {
        id: 'legacy-napcat',
        name: '旧 NapCat',
        protocol: 'onebot11',
        managementKind: 'none',
        managementUrl: '',
        businessUrl: 'https://onebot.example',
        eventUrl: '',
        createdAt: CREATED,
        updatedAt: NOW
      }
    ])
    expect(state.activeId).toBe('legacy-napcat')
    expect(state.migratedInstanceIds).toEqual(['legacy-napcat'])
    expect(state.changed).toBe(true)
  })

  it('never derives a business URL from the retired management address', () => {
    const state = migrateStoredInstanceState(
      stored([
        napcatInstance({
          managementUrl: 'http://localhost:6099',
          businessUrl: ''
        })
      ]),
      NOW
    )

    expect(state.instances[0]).toMatchObject({
      managementKind: 'none',
      managementUrl: '',
      businessUrl: ''
    })
  })

  it('is idempotent and does not bump updatedAt again', () => {
    const first = migrateStoredInstanceState(stored([napcatInstance()]), NOW)
    const persisted = stored(first.instances, first.activeId)
    const second = migrateStoredInstanceState(persisted, LATER)

    expect(second.instances).toEqual(first.instances)
    expect(second.instances[0].updatedAt).toBe(NOW)
    expect(second.migratedInstanceIds).toEqual([])
    expect(second.changed).toBe(false)
  })

  it('preserves other instances, active selection and state format', () => {
    const state = migrateStoredInstanceState(
      stored([napcatInstance(), adminInstance()], 'milky-admin'),
      NOW
    )

    expect(state.activeId).toBe('milky-admin')
    expect(state.instances[1]).toEqual(adminInstance())
    expect(state.migratedInstanceIds).toEqual(['legacy-napcat'])
  })

  it('clears stale management addresses from protocol-only instances', () => {
    const state = migrateStoredInstanceState(
      stored([
        adminInstance({
          managementKind: 'none',
          managementUrl: 'https://old.example/admin/v1'
        })
      ]),
      NOW
    )

    expect(state.instances[0]).toMatchObject({
      managementKind: 'none',
      managementUrl: ''
    })
    expect(state.changed).toBe(true)
  })

  it('drops unknown entries and repairs an invalid active selection', () => {
    const state = migrateStoredInstanceState(
      stored(
        [
          adminInstance(),
          { id: 'broken', protocol: 'unknown', managementKind: 'none' },
          napcatInstance({ managementKind: 'unknown-retired-kind' })
        ],
        'missing-instance'
      ),
      NOW
    )

    expect(state.instances.map((item) => item.id)).toEqual(['milky-admin'])
    expect(state.activeId).toBe('milky-admin')
    expect(state.changed).toBe(true)
  })

  it('handles damaged storage without inventing an instance', () => {
    const fromGarbage = migrateStoredInstanceState('{not-json', NOW)
    const fromNull = migrateStoredInstanceState(null, NOW)

    expect(fromGarbage.instances).toEqual([])
    expect(fromNull.instances).toEqual([])
    expect(fromGarbage.changed).toBe(true)
  })
})

describe('retired NapCat state cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('removes retired credentials without touching business tokens or cursors', () => {
    localStorage.setItem(
      instancesStorageKey,
      stored([
        napcatInstance(),
        adminInstance({ id: 'milky-admin-2', managementKind: 'none' })
      ])
    )
    localStorage.setItem('token', JSON.stringify('napcat-management-token'))
    localStorage.setItem('storeURL', JSON.stringify('http://localhost:6099'))
    localStorage.setItem('nyarugram.admin-session-active', '1')
    sessionStorage.setItem(
      'nyarugram.instance.legacy-napcat.napcatToken',
      'napcat-token'
    )
    sessionStorage.setItem(
      'nyarugram.instance.milky-admin-2.businessToken',
      'business-token'
    )
    sessionStorage.setItem(
      'nyarugram.events.v3.milky-admin-2',
      '{"cursor":{"seq":9}}'
    )

    const state = readPersistedInstanceState()

    expect(state.migratedInstanceIds).toEqual(['legacy-napcat'])
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('storeURL')).toBeNull()
    expect(localStorage.getItem('nyarugram.admin-session-active')).toBeNull()
    expect(
      sessionStorage.getItem('nyarugram.instance.legacy-napcat.napcatToken')
    ).toBeNull()
    // The retired NapCat management token must never become a business token.
    expect(
      sessionStorage.getItem('nyarugram.instance.legacy-napcat.businessToken')
    ).toBeNull()
    expect(
      sessionStorage.getItem('nyarugram.instance.milky-admin-2.businessToken')
    ).toBe('business-token')
    expect(sessionStorage.getItem('nyarugram.events.v3.milky-admin-2')).toBe(
      '{"cursor":{"seq":9}}'
    )

    const persisted = JSON.parse(
      localStorage.getItem(instancesStorageKey) ?? '{}'
    )
    expect(persisted.instances[0]).toMatchObject({
      id: 'legacy-napcat',
      managementKind: 'none',
      managementUrl: ''
    })
    expect(Object.keys(persisted).sort()).toEqual(['activeId', 'instances'])
  })

  it('does not create an instance from the retired global storeURL', () => {
    localStorage.setItem('storeURL', JSON.stringify('http://localhost:6099'))

    const state = readPersistedInstanceState()

    expect(state.instances).toEqual([])
    expect(state.activeId).toBe('')
    expect(localStorage.getItem('storeURL')).toBeNull()
  })

  it('can be executed repeatedly without changing the stored state', () => {
    localStorage.setItem(instancesStorageKey, stored([napcatInstance()]))
    readPersistedInstanceState()
    const first = localStorage.getItem(instancesStorageKey)

    readPersistedInstanceState()

    expect(localStorage.getItem(instancesStorageKey)).toBe(first)
  })

  it('removes keys matching the retired token pattern only', () => {
    sessionStorage.setItem('nyarugram.instance.a.napcatToken', 'a')
    sessionStorage.setItem('nyarugram.instance.b.napcatToken', 'b')
    sessionStorage.setItem('nyarugram.instance.c.businessToken', 'c')
    sessionStorage.setItem('unrelated.napcatToken', 'keep')

    purgeRetiredNapcatState()

    expect(
      sessionStorage.getItem('nyarugram.instance.a.napcatToken')
    ).toBeNull()
    expect(
      sessionStorage.getItem('nyarugram.instance.b.napcatToken')
    ).toBeNull()
    expect(sessionStorage.getItem('nyarugram.instance.c.businessToken')).toBe(
      'c'
    )
    expect(sessionStorage.getItem('unrelated.napcatToken')).toBe('keep')
  })
})
