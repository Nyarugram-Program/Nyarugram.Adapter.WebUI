import { act, cleanup, renderHook } from '@testing-library/react'
import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEventIdentity } from '@/components/milky/use-event-identity'

import type { AdapterInstance } from '@/types/instance'

import MilkyManager from './milky_manager'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    request: vi.fn(),
    isAxiosError: () => false
  }
}))

const postMock = vi.mocked(axios.post)
const instance: AdapterInstance = {
  id: 'milky-test',
  name: 'Milky test',
  protocol: 'milky',
  managementKind: 'none',
  managementUrl: '',
  businessUrl: 'https://adapter.example',
  eventUrl: 'https://adapter.example/event',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z'
}

const failedBody = (retcode: number) => ({
  status: 'failed',
  retcode,
  message: 'temporarily unavailable',
  data: null
})

const response = (status: number, body: unknown, retryAfter?: string) => ({
  status,
  data: JSON.stringify(body),
  headers: retryAfter ? { 'retry-after': retryAfter } : {}
})

beforeEach(() => {
  postMock.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Milky HTTP error metadata', () => {
  it.each([
    { status: 429, body: failedBody(-429), retcode: -429 },
    { status: 503, body: failedBody(-501), retcode: -501 },
    { status: 200, body: failedBody(-429), retcode: -429 },
    { status: 503, body: { unexpected: true }, retcode: undefined },
    { status: 503, body: null, retcode: undefined }
  ])(
    'preserves HTTP $status and Retry-After through getLoginInfo',
    async ({ status, body, retcode }) => {
      postMock.mockResolvedValueOnce(response(status, body, '60'))

      await expect(
        MilkyManager.getLoginInfo(instance, 'test-token')
      ).rejects.toMatchObject({
        name: 'MilkyRequestError',
        status,
        retcode,
        retryAfterMs: 60_000
      })
    }
  )

  it('preserves retry metadata for a non-JSON proxy error', async () => {
    postMock.mockResolvedValueOnce({
      status: 503,
      data: '<html>temporarily unavailable</html>',
      headers: { 'retry-after': '10' }
    })

    await expect(
      MilkyManager.getLoginInfo(instance, 'test-token')
    ).rejects.toMatchObject({
      status: 503,
      retryAfterMs: 10_000
    })
  })

  it('accepts an HTTP-date Retry-After', async () => {
    postMock.mockResolvedValueOnce(
      response(429, failedBody(-429), 'Sun, 08 Nov 2026 12:01:00 GMT')
    )

    await expect(
      MilkyManager.getLoginInfo(instance, 'test-token')
    ).rejects.toMatchObject({ retryAfterMs: 60_000 })
  })

  it('ignores an invalid Retry-After while retaining the HTTP status', async () => {
    postMock.mockResolvedValueOnce(
      response(503, failedBody(-503), 'invalid-delay')
    )

    await expect(
      MilkyManager.getLoginInfo(instance, 'test-token')
    ).rejects.toMatchObject({
      status: 503,
      retcode: -503,
      retryAfterMs: undefined
    })
  })

  it('keeps the public call response as the original Milky envelope', async () => {
    const body = failedBody(-429)
    postMock.mockResolvedValueOnce(response(429, body, '60'))

    expect(
      await MilkyManager.call(instance, 'test-token', 'get_login_info')
    ).toEqual(body)
  })

  it('keeps successful account ids exact', async () => {
    postMock.mockResolvedValueOnce({
      status: 200,
      data: '{"status":"ok","retcode":0,"data":{"uin":9223372036854775807,"nickname":"Bot"},"message":null}',
      headers: {}
    })

    expect(await MilkyManager.getLoginInfo(instance, 'test-token')).toEqual({
      uin: 9223372036854775807n,
      nickname: 'Bot'
    })
  })
})

describe('no-management identity retry through MilkyManager', () => {
  it('waits for the actual HTTP Retry-After before querying identity again', async () => {
    postMock
      .mockResolvedValueOnce(response(429, failedBody(-429), '60'))
      .mockResolvedValueOnce(
        response(200, {
          status: 'ok',
          retcode: 0,
          data: { uin: 100005, nickname: 'Bot Two' },
          message: null
        })
      )

    const { result } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: 'test-token',
        enabled: true
      })
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.state).toMatchObject({
      status: 'error',
      retryable: true,
      nextRetryAt: Date.now() + 60_000
    })
    expect(postMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(59_999)
    })
    expect(postMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'business:100005' }
    })
    expect(postMock.mock.calls[0][0]).toBe(
      'https://adapter.example/api/get_login_info'
    )
  })
})
