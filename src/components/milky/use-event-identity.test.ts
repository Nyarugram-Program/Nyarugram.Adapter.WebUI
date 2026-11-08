import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MilkyManager, { MilkyRequestError } from '@/controllers/milky_manager'
import NyarugramAdminManager, {
  AdminRequestError
} from '@/controllers/nyarugram_admin_manager'
import type { AdapterInstance } from '@/types/instance'

import { useEventIdentity } from './use-event-identity'

vi.mock('@/controllers/nyarugram_admin_manager', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/controllers/nyarugram_admin_manager')
    >()
  return {
    ...actual,
    default: { getAccount: vi.fn() }
  }
})

vi.mock('@/controllers/milky_manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/controllers/milky_manager')>()
  return {
    ...actual,
    default: { getLoginInfo: vi.fn() }
  }
})

const getAccount = NyarugramAdminManager.getAccount as unknown as ReturnType<
  typeof vi.fn
>
const getLoginInfo = MilkyManager.getLoginInfo as unknown as ReturnType<
  typeof vi.fn
>

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const adminInstance = (
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

const noneInstance = () =>
  adminInstance({ id: 'instance-none', managementKind: 'none' })

const account = (id: string, display: string, uin: string) => ({
  account_id: id,
  display_name: display,
  numeric_user_id: uin,
  state: 'active'
})

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  getAccount.mockReset()
  getLoginInfo.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useEventIdentity retry lifecycle', () => {
  it('retries a transient admin failure and becomes ready without an event connection', async () => {
    const instance = adminInstance()
    getAccount
      .mockRejectedValueOnce(new AdminRequestError('HTTP 500', { status: 500 }))
      .mockResolvedValueOnce(account('uuid-a', 'Bot', '100001'))

    const { result } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: '',
        enabled: true
      })
    )
    await flush()

    expect(result.current.state).toMatchObject({
      status: 'error',
      retryable: true
    })
    expect(getAccount).toHaveBeenCalledTimes(1)

    await advance(1000)
    await flush()

    expect(getAccount).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'admin:uuid-a', label: 'Bot (100001)' }
    })
  })

  it('honors Retry-After for 429 responses', async () => {
    const instance = adminInstance()
    getAccount
      .mockRejectedValueOnce(
        new AdminRequestError('HTTP 429', {
          status: 429,
          retryAfterMs: 5000
        })
      )
      .mockResolvedValueOnce(account('uuid-a', 'Bot', '100001'))

    const { result } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: '',
        enabled: true
      })
    )
    await flush()

    await advance(4999)
    expect(getAccount).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({
      status: 'error',
      retryable: true
    })

    await advance(1)
    await flush()
    expect(getAccount).toHaveBeenCalledTimes(2)
    expect(result.current.state.status).toBe('ready')
  })

  it('uses a slow retry for an unauthenticated account instead of tight-looping', async () => {
    const instance = adminInstance()
    getAccount.mockResolvedValue({
      state: 'not_logged_in',
      reason: 'no backend account'
    })

    const { result } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: '',
        enabled: true
      })
    )
    await flush()

    expect(result.current.state).toMatchObject({
      status: 'error',
      retryable: true,
      reason: 'no backend account'
    })
    await advance(1000)
    expect(getAccount).toHaveBeenCalledTimes(1)

    await advance(29000)
    await flush()
    expect(getAccount).toHaveBeenCalledTimes(2)
  })

  it('manual retry cancels the scheduled retry and does not duplicate queries', async () => {
    const instance = adminInstance()
    getAccount
      .mockRejectedValueOnce(new AdminRequestError('HTTP 500', { status: 500 }))
      .mockResolvedValueOnce(account('uuid-a', 'Bot', '100001'))

    const { result } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: '',
        enabled: true
      })
    )
    await flush()
    expect(getAccount).toHaveBeenCalledTimes(1)

    act(() => result.current.retryNow())
    await flush()
    expect(getAccount).toHaveBeenCalledTimes(2)
    expect(result.current.state.status).toBe('ready')

    await advance(10000)
    expect(getAccount).toHaveBeenCalledTimes(2)
  })

  it('does not let a late old-instance query overwrite the new instance', async () => {
    const oldQuery = deferred<ReturnType<typeof account>>()
    getAccount
      .mockImplementationOnce(() => oldQuery.promise)
      .mockResolvedValueOnce(account('uuid-b', 'Bot Two', '100005'))

    const { result, rerender } = renderHook(
      (props: { instance: AdapterInstance }) =>
        useEventIdentity({
          instance: props.instance,
          generation: 1,
          token: '',
          enabled: true
        }),
      { initialProps: { instance: adminInstance() } }
    )
    await flush()
    rerender({ instance: adminInstance({ id: 'instance-b' }) })
    await flush()

    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'admin:uuid-b' }
    })

    oldQuery.resolve(account('uuid-a', 'Bot', '100001'))
    await flush()
    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'admin:uuid-b' }
    })
  })

  it('clears the retry timer on unmount', async () => {
    const instance = adminInstance()
    getAccount.mockRejectedValue(
      new AdminRequestError('HTTP 500', { status: 500 })
    )

    const { unmount } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: '',
        enabled: true
      })
    )
    await flush()
    expect(getAccount).toHaveBeenCalledTimes(1)
    unmount()

    await advance(10000)
    expect(getAccount).toHaveBeenCalledTimes(1)
  })

  it('retries a transient no-management failure and then resolves the business uin', async () => {
    const instance = noneInstance()
    getLoginInfo
      .mockRejectedValueOnce(new MilkyRequestError('HTTP 503', { status: 503 }))
      .mockResolvedValueOnce({ uin: 100005, nickname: 'Bot Two' })

    const { result } = renderHook(() =>
      useEventIdentity({
        instance,
        generation: 1,
        token: 'token-1',
        enabled: true
      })
    )
    await flush()
    expect(result.current.state).toMatchObject({
      status: 'error',
      retryable: true
    })

    await advance(1000)
    await flush()
    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'business:100005', label: 'Bot Two (100005)' }
    })
    expect(getLoginInfo).toHaveBeenCalledTimes(2)
  })
  it('switches to B during an A retry timer without querying A again', async () => {
    const instanceA = adminInstance()
    const instanceB = adminInstance({ id: 'instance-b' })
    getAccount
      .mockRejectedValueOnce(new AdminRequestError('HTTP 500', { status: 500 }))
      .mockResolvedValueOnce(account('uuid-b', 'Bot Two', '100005'))

    const { result, rerender } = renderHook(
      (props: { instance: AdapterInstance }) =>
        useEventIdentity({
          instance: props.instance,
          generation: 1,
          token: '',
          enabled: true
        }),
      { initialProps: { instance: instanceA } }
    )
    await flush()
    expect(result.current.state).toMatchObject({
      status: 'error',
      retryable: true
    })

    rerender({ instance: instanceB })
    await flush()
    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'admin:uuid-b' }
    })

    await advance(10000)
    expect(getAccount).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({
      status: 'ready',
      account: { value: 'admin:uuid-b' }
    })
  })
})
