import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearInstanceSecrets,
  getInstanceBusinessToken,
  getNapcatToken,
  migrateLegacyNapcatToken,
  setInstanceBusinessToken,
  setNapcatToken
} from './instance-secrets'

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

  it('isolates NapCat tokens by instance', () => {
    setNapcatToken('a', 'napcat-a')
    setNapcatToken('b', 'napcat-b')

    expect(getNapcatToken('a')).toBe('napcat-a')
    expect(getNapcatToken('b')).toBe('napcat-b')
  })

  it('clears both token kinds for one instance only', () => {
    setInstanceBusinessToken('a', 'business-a')
    setNapcatToken('a', 'napcat-a')
    setInstanceBusinessToken('b', 'business-b')

    clearInstanceSecrets('a')

    expect(getInstanceBusinessToken('a')).toBe('')
    expect(getNapcatToken('a')).toBe('')
    expect(getInstanceBusinessToken('b')).toBe('business-b')
  })

  it('migrates the legacy global NapCat token to one instance and removes it', () => {
    localStorage.setItem('token', JSON.stringify('legacy-token'))

    migrateLegacyNapcatToken(['first', 'second'])

    expect(getNapcatToken('first')).toBe('legacy-token')
    expect(getNapcatToken('second')).toBe('')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('does not overwrite an existing instance token during migration', () => {
    localStorage.setItem('token', JSON.stringify('legacy-token'))
    setNapcatToken('first', 'current-token')

    migrateLegacyNapcatToken(['first', 'second'])

    expect(getNapcatToken('first')).toBe('current-token')
    expect(getNapcatToken('second')).toBe('legacy-token')
  })
})
