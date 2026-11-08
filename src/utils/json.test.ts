import { describe, expect, it } from 'vitest'

import { parseJson, stringifyJson } from './json'

describe('JSON int64 handling', () => {
  it('keeps signed 64-bit identifiers exact instead of rounding them', () => {
    const text = '{"user_id":9223372036854775807,"group_id":-9223372036854775808}'
    const parsed = parseJson(text) as {
      user_id: bigint
      group_id: bigint
    }

    expect(parsed.user_id).toBe(9223372036854775807n)
    expect(parsed.group_id).toBe(-9223372036854775808n)
    expect(stringifyJson(parsed)).toBe(text)
  })

  it('still returns ordinary integers as numbers', () => {
    const parsed = parseJson('{"seq":42,"ratio":1.5}') as {
      seq: number
      ratio: number
    }

    expect(parsed.seq).toBe(42)
    expect(parsed.ratio).toBe(1.5)
  })

  it('does not turn unsafe integers into floating point values', () => {
    const parsed = parseJson('9007199254740993') as bigint
    expect(parsed).toBe(9007199254740993n)
    expect(String(parsed)).toBe('9007199254740993')
  })
})
