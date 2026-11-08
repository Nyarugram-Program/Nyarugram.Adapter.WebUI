import { describe, expect, it } from 'vitest'

import {
  type ManagementKind,
  managementKinds,
  managementLabels
} from './instance'

describe('management kind options', () => {
  it('offers only the two supported management modes', () => {
    expect(managementKinds).toEqual(['nyarugram-admin-v1', 'none'])
  })

  it('has a label for every selectable mode', () => {
    const labelKeys = Object.keys(managementLabels).sort()
    expect(labelKeys).toEqual([...managementKinds].sort())
  })

  it('does not accept the retired NapCat mode', () => {
    expect(managementKinds as readonly string[]).not.toContain('napcat')
    expect(managementLabels as Record<string, string>).not.toHaveProperty(
      'napcat'
    )
  })

  it('keeps the management kind type closed', () => {
    const kinds: ManagementKind[] = ['nyarugram-admin-v1', 'none']
    expect(kinds).toHaveLength(2)
  })
})
