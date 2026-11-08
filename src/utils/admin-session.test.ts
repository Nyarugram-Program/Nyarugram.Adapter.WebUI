import { beforeEach, describe, expect, it } from 'vitest'

import {
  discardLegacyAdminSessionMarker,
  hasAdminSessionMarker,
  setAdminSessionMarker
} from './admin-session'

describe('per-instance admin session marker', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('does not authenticate another instance', () => {
    setAdminSessionMarker('instance-a', true, 'https://a.example/admin/v1')

    expect(
      hasAdminSessionMarker('instance-a', 'https://a.example/admin/v1')
    ).toBe(true)
    expect(
      hasAdminSessionMarker('instance-b', 'https://b.example/admin/v1')
    ).toBe(false)
  })

  it('invalidates a marker when the management origin changes', () => {
    setAdminSessionMarker('instance-a', true, 'https://a.example/admin/v1')

    expect(
      hasAdminSessionMarker('instance-a', 'https://other.example/admin/v1')
    ).toBe(false)
  })

  it('clears its own marker without touching another instance', () => {
    setAdminSessionMarker('instance-a', true, 'https://a.example/admin/v1')
    setAdminSessionMarker('instance-b', true, 'https://b.example/admin/v1')

    setAdminSessionMarker('instance-a', false, 'https://a.example/admin/v1')

    expect(
      hasAdminSessionMarker('instance-a', 'https://a.example/admin/v1')
    ).toBe(false)
    expect(
      hasAdminSessionMarker('instance-b', 'https://b.example/admin/v1')
    ).toBe(true)
  })

  it('discards the legacy global marker instead of guessing its instance', () => {
    localStorage.setItem('nyarugram.admin-session-active', '1')

    discardLegacyAdminSessionMarker()

    expect(localStorage.getItem('nyarugram.admin-session-active')).toBeNull()
  })
})
