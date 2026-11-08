import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearInstanceSecrets,
  getInstanceBusinessToken,
  setInstanceBusinessToken
} from './instance-secrets'
import { getOneBotBusinessToken, setOneBotBusinessToken } from './onebot-debug'

describe('per-instance credentials', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('isolates business tokens by instance', () => {
    setInstanceBusinessToken('a', 'token-a')
    setInstanceBusinessToken('b', 'token-b')

    expect(getInstanceBusinessToken('a')).toBe('token-a')
    expect(getInstanceBusinessToken('b')).toBe('token-b')
    expect(getInstanceBusinessToken('c')).toBe('')
  })

  it('clears business and retired debug keys for one instance only', () => {
    setInstanceBusinessToken('a', 'business-a')
    sessionStorage.setItem('nyarugram.instance.a.napcatToken', 'retired-a')
    sessionStorage.setItem(
      'nyarugram.instance.a.onebot.businessToken',
      'legacy-debug-a'
    )
    setInstanceBusinessToken('b', 'business-b')

    clearInstanceSecrets('a')

    expect(getInstanceBusinessToken('a')).toBe('')
    expect(
      sessionStorage.getItem('nyarugram.instance.a.napcatToken')
    ).toBeNull()
    expect(
      sessionStorage.getItem('nyarugram.instance.a.onebot.businessToken')
    ).toBeNull()
    expect(getInstanceBusinessToken('b')).toBe('business-b')
  })

  it('migrates an old OneBot business token once through either reader', () => {
    sessionStorage.setItem(
      'nyarugram.instance.a.onebot.businessToken',
      'legacy-a'
    )

    expect(getInstanceBusinessToken('a')).toBe('legacy-a')
    expect(getOneBotBusinessToken('a')).toBe('legacy-a')
    expect(sessionStorage.getItem('nyarugram.instance.a.businessToken')).toBe(
      'legacy-a'
    )
    expect(
      sessionStorage.getItem('nyarugram.instance.a.onebot.businessToken')
    ).toBeNull()
  })

  it('clears an unmigrated token from the instance page without resurrecting it', () => {
    sessionStorage.setItem(
      'nyarugram.instance.a.onebot.businessToken',
      'legacy-a'
    )
    sessionStorage.setItem(
      'nyarugram.instance.b.onebot.businessToken',
      'legacy-b'
    )
    sessionStorage.setItem('nyarugram.events.v3.test', 'unchanged-cursor')

    setInstanceBusinessToken('a', '')

    expect(getInstanceBusinessToken('a')).toBe('')
    expect(getOneBotBusinessToken('a')).toBe('')
    expect(
      sessionStorage.getItem('nyarugram.instance.a.onebot.businessToken')
    ).toBeNull()
    expect(
      sessionStorage.getItem('nyarugram.instance.b.onebot.businessToken')
    ).toBe('legacy-b')
    expect(sessionStorage.getItem('nyarugram.events.v3.test')).toBe(
      'unchanged-cursor'
    )
  })

  it('replaces an old token through instance settings and can clear it permanently', () => {
    sessionStorage.setItem(
      'nyarugram.instance.a.onebot.businessToken',
      'legacy-a'
    )

    setInstanceBusinessToken('a', 'replacement-a')
    expect(getOneBotBusinessToken('a')).toBe('replacement-a')
    expect(
      sessionStorage.getItem('nyarugram.instance.a.onebot.businessToken')
    ).toBeNull()

    setInstanceBusinessToken('a', '')
    expect(getOneBotBusinessToken('a')).toBe('')
  })

  it('keeps the current key authoritative, including an explicitly empty value', () => {
    for (const current of ['current-a', '']) {
      sessionStorage.setItem('nyarugram.instance.a.businessToken', current)
      sessionStorage.setItem(
        'nyarugram.instance.a.onebot.businessToken',
        'stale-a'
      )

      expect(getOneBotBusinessToken('a')).toBe(current)
      expect(getInstanceBusinessToken('a')).toBe(current)
      expect(
        sessionStorage.getItem('nyarugram.instance.a.onebot.businessToken')
      ).toBeNull()
    }
  })

  it('shares OneBot writes and clears with the instance credential reader', () => {
    sessionStorage.setItem(
      'nyarugram.instance.a.onebot.businessToken',
      'legacy-a'
    )

    setOneBotBusinessToken('a', 'replacement-a')
    expect(getInstanceBusinessToken('a')).toBe('replacement-a')
    expect(
      sessionStorage.getItem('nyarugram.instance.a.onebot.businessToken')
    ).toBeNull()

    setOneBotBusinessToken('a', '')
    expect(getInstanceBusinessToken('a')).toBe('')
    expect(getOneBotBusinessToken('a')).toBe('')
  })

  it('never migrates a retired NapCat management token into a business token', () => {
    sessionStorage.setItem('nyarugram.instance.a.napcatToken', 'management-a')

    expect(getInstanceBusinessToken('a')).toBe('')
    expect(getOneBotBusinessToken('a')).toBe('')
    expect(
      sessionStorage.getItem('nyarugram.instance.a.businessToken')
    ).toBeNull()
  })
})
