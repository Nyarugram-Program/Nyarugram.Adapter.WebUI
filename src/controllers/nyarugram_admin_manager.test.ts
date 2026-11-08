import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterInstance } from '@/types/instance'

import NyarugramAdminManager, {
  AdminOperationInvalidatedError
} from './nyarugram_admin_manager'

vi.mock('axios', () => {
  const request = vi.fn()
  return {
    default: {
      request,
      isAxiosError: (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        (error as { isAxiosError?: boolean }).isAxiosError === true
    }
  }
})

const requestMock = axios.request as unknown as ReturnType<typeof vi.fn>

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ok = (data: unknown) => ({ data: { data } })

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const axiosError = (status: number, code?: string) => {
  const error = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean
    response: {
      status: number
      data: { error: { code?: string; message: string } }
    }
  }
  error.isAxiosError = true
  error.response = {
    status,
    data: { error: { code, message: 'test error' } }
  }
  return error
}

const makeInstance = (id: string, managementUrl: string): AdapterInstance => ({
  id,
  name: id,
  protocol: 'milky',
  managementKind: 'nyarugram-admin-v1',
  managementUrl,
  businessUrl: 'https://business.example',
  eventUrl: 'wss://business.example/event',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z'
})

const saveRequest = { values: {}, secrets: {} }

const calls = (method: string, url: string) =>
  requestMock.mock.calls.filter(
    ([config]) =>
      String(config.method).toLowerCase() === method.toLowerCase() &&
      String(config.url) === url
  )

const putHeaders = (index: number) =>
  calls('PUT', '/config')[index][0].headers as Record<string, string>

beforeEach(() => {
  requestMock.mockReset()
  NyarugramAdminManager.clearSessionCacheForTests()
})

describe('management CSRF isolation', () => {
  it('sends each instance its own CSRF value when alternating writes', async () => {
    const instanceA = makeInstance('a', 'https://a.example/admin/v1')
    const instanceB = makeInstance('b', 'https://b.example/admin/v1')

    requestMock.mockImplementation(
      async (config: { method: string; url: string; baseURL: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: config.baseURL.includes('a.example')
              ? 'csrf-a'
              : 'csrf-b'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.saveConfig(instanceA, saveRequest, '0')
    await NyarugramAdminManager.saveConfig(instanceB, saveRequest, '0')
    await NyarugramAdminManager.saveConfig(instanceA, saveRequest, '0')

    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(3)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-a')
    expect(putHeaders(1)['X-CSRF-Token']).toBe('csrf-b')
    expect(putHeaders(2)['X-CSRF-Token']).toBe('csrf-a')
  })

  it('keeps B unaffected by a delayed A session response', async () => {
    const instanceA = makeInstance('a', 'https://a.example/admin/v1')
    const instanceB = makeInstance('b', 'https://b.example/admin/v1')
    const sessionA = deferred<ReturnType<typeof ok>>()

    requestMock.mockImplementation(
      async (config: { method: string; url: string; baseURL: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          if (config.baseURL.includes('a.example')) return sessionA.promise
          return ok({ authenticated: true, csrf_token: 'csrf-b' })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    const pendingA = NyarugramAdminManager.getSession(instanceA)
    expect(await NyarugramAdminManager.getSession(instanceB)).toMatchObject({
      csrf_token: 'csrf-b'
    })
    await NyarugramAdminManager.saveConfig(instanceB, saveRequest, '0')

    sessionA.resolve(ok({ authenticated: true, csrf_token: 'csrf-a' }))
    await pendingA

    await NyarugramAdminManager.saveConfig(instanceB, saveRequest, '0')

    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(2)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-b')
    expect(putHeaders(1)['X-CSRF-Token']).toBe('csrf-b')
  })

  it('lets a newer login win over a delayed older login response', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const firstLogin = deferred<ReturnType<typeof ok>>()

    let loginCount = 0
    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'POST' && config.url === '/session') {
          loginCount += 1
          if (loginCount === 1) return firstLogin.promise
          return ok({ authenticated: true, csrf_token: 'csrf-new' })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    const older = NyarugramAdminManager.login(instance, 'default', 'secret')
    await NyarugramAdminManager.login(instance, 'default', 'secret')
    firstLogin.resolve(ok({ authenticated: true, csrf_token: 'csrf-old' }))
    await expect(older).rejects.toBeInstanceOf(AdminOperationInvalidatedError)

    await NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(1)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-new')
  })

  it('does not let an old 401 clear a newer session token', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const oldWrite = deferred<never>()
    let putCount = 0
    let loginCount = 0

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({ authenticated: true, csrf_token: 'csrf-old' })
        }
        if (config.method === 'POST' && config.url === '/session') {
          loginCount += 1
          return ok({
            authenticated: true,
            csrf_token: `csrf-new-${loginCount}`
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          putCount += 1
          if (putCount === 1) return oldWrite.promise
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    const failingWrite = NyarugramAdminManager.saveConfig(
      instance,
      saveRequest,
      '0'
    )
    await tick()
    expect(calls('PUT', '/config')).toHaveLength(1)
    await NyarugramAdminManager.login(instance, 'default', 'secret')

    oldWrite.reject(axiosError(401))
    await expect(failingWrite).rejects.toMatchObject({ status: 401 })

    await NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(2)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-old')
    expect(putHeaders(1)['X-CSRF-Token']).toBe('csrf-new-1')
  })

  it('does not let an old logout completion clear a newer login', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const oldLogout = deferred<ReturnType<typeof ok>>()
    let deleteCount = 0

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({ authenticated: true, csrf_token: 'csrf-old' })
        }
        if (config.method === 'POST' && config.url === '/session') {
          return ok({ authenticated: true, csrf_token: 'csrf-new' })
        }
        if (config.method === 'DELETE' && config.url === '/session') {
          deleteCount += 1
          if (deleteCount === 1) return oldLogout.promise
          return ok({})
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    const logout = NyarugramAdminManager.logout(instance)
    await tick()
    expect(calls('DELETE', '/session')).toHaveLength(1)
    await NyarugramAdminManager.login(instance, 'default', 'secret')
    oldLogout.resolve(ok({}))
    await expect(logout).rejects.toBeInstanceOf(AdminOperationInvalidatedError)

    await NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(1)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-new')
  })

  it('does not reuse a CSRF value after the management URL changes', async () => {
    const oldInstance = makeInstance('a', 'https://old.example/admin/v1')
    const newInstance = makeInstance('a', 'https://new.example/admin/v1')

    requestMock.mockImplementation(
      async (config: { method: string; url: string; baseURL: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: config.baseURL.includes('old.example')
              ? 'csrf-old'
              : 'csrf-new'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(oldInstance)
    await NyarugramAdminManager.saveConfig(newInstance, saveRequest, '0')

    const sessions = calls('GET', '/session')
    expect(sessions).toHaveLength(2)
    expect(sessions[1][0].baseURL).toBe('https://new.example/admin/v1')
    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(1)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-new')
  })

  it('coalesces concurrent session fetches for one instance', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const session = deferred<ReturnType<typeof ok>>()

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return session.promise
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    const first = NyarugramAdminManager.getSession(instance)
    const second = NyarugramAdminManager.getSession(instance)
    session.resolve(ok({ authenticated: true, csrf_token: 'csrf-a' }))

    await expect(first).resolves.toMatchObject({ csrf_token: 'csrf-a' })
    await expect(second).resolves.toMatchObject({ csrf_token: 'csrf-a' })
    expect(calls('GET', '/session')).toHaveLength(1)
  })

  it('retries a csrf_rejected write exactly once with a fresh token', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    let putCount = 0
    let sessionCount = 0

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          sessionCount += 1
          return ok({
            authenticated: true,
            csrf_token: sessionCount === 1 ? 'csrf-old' : 'csrf-new',
            session_id: 'session-1'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          putCount += 1
          if (putCount === 1) throw axiosError(403, 'csrf_rejected')
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.saveConfig(instance, saveRequest, '0')

    const puts = calls('PUT', '/config')
    expect(puts).toHaveLength(2)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-old')
    expect(putHeaders(1)['X-CSRF-Token']).toBe('csrf-new')
    expect(calls('GET', '/session')).toHaveLength(2)
  })

  it('keeps the management CSRF when a backend account login returns 401', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({ authenticated: true, csrf_token: 'csrf-a' })
        }
        if (config.method === 'POST' && config.url === '/account/login') {
          throw axiosError(401)
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    await expect(
      NyarugramAdminManager.loginAccount(instance, 'bot', 'wrong')
    ).rejects.toMatchObject({ status: 401 })
    await NyarugramAdminManager.saveConfig(instance, saveRequest, '0')

    expect(calls('GET', '/session')).toHaveLength(1)
    expect(putHeaders(0)['X-CSRF-Token']).toBe('csrf-a')
  })

  it('does not retry a second csrf_rejected response', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-old',
            session_id: 'session-1'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          throw axiosError(403, 'csrf_rejected')
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await expect(
      NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    ).rejects.toMatchObject({ status: 403, code: 'csrf_rejected' })
    expect(calls('PUT', '/config')).toHaveLength(2)
  })
  it('does not retry an old PUT with the new login CSRF', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const oldPut = deferred<ReturnType<typeof ok>>()
    let putCount = 0

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-1',
            session_id: 'session-1'
          })
        }
        if (config.method === 'POST' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-2',
            session_id: 'session-2'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          putCount += 1
          if (putCount === 1) return oldPut.promise
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    const write = NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    await tick()
    expect(calls('PUT', '/config')).toHaveLength(1)

    await NyarugramAdminManager.login(instance, 'default', 'secret')
    oldPut.reject(axiosError(403, 'csrf_rejected'))

    await expect(write).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
    expect(calls('PUT', '/config')).toHaveLength(1)
  })

  it('does not retry an old DELETE with the new login CSRF', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const oldDelete = deferred<ReturnType<typeof ok>>()
    let deleteCount = 0

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-1',
            session_id: 'session-1'
          })
        }
        if (config.method === 'POST' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-2',
            session_id: 'session-2'
          })
        }
        if (config.method === 'DELETE' && config.url === '/session') {
          deleteCount += 1
          if (deleteCount === 1) return oldDelete.promise
          return ok({})
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    const logout = NyarugramAdminManager.logout(instance)
    await tick()
    expect(calls('DELETE', '/session')).toHaveLength(1)

    await NyarugramAdminManager.login(instance, 'default', 'secret')
    oldDelete.reject(axiosError(403, 'csrf_rejected'))

    await expect(logout).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
    expect(calls('DELETE', '/session')).toHaveLength(1)
  })

  it('aborts a waiting write when a login changes the generation', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const sessionFetch = deferred<ReturnType<typeof ok>>()

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return sessionFetch.promise
        }
        if (config.method === 'POST' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-new',
            session_id: 'session-2'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    const write = NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    await tick()
    expect(calls('GET', '/session')).toHaveLength(1)
    await NyarugramAdminManager.login(instance, 'default', 'secret')
    sessionFetch.resolve(
      ok({
        authenticated: true,
        csrf_token: 'csrf-old',
        session_id: 'session-1'
      })
    )

    await expect(write).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
    expect(calls('PUT', '/config')).toHaveLength(0)
  })

  it('aborts a waiting write after the management URL changes', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const sessionFetch = deferred<ReturnType<typeof ok>>()

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return sessionFetch.promise
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return ok({ version: '1' })
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    const write = NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    await tick()
    NyarugramAdminManager.invalidateSession(instance.id)
    sessionFetch.resolve(
      ok({
        authenticated: true,
        csrf_token: 'csrf-old',
        session_id: 'session-1'
      })
    )

    await expect(write).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
    expect(calls('PUT', '/config')).toHaveLength(0)
  })

  it('does not treat a new session id as a CSRF refresh', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    let sessionCount = 0
    let putCount = 0

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          sessionCount += 1
          return ok({
            authenticated: true,
            csrf_token: sessionCount === 1 ? 'csrf-1' : 'csrf-2',
            session_id: sessionCount === 1 ? 'session-1' : 'session-2'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          putCount += 1
          throw axiosError(403, 'csrf_rejected')
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    await expect(
      NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    ).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
    expect(calls('PUT', '/config')).toHaveLength(1)
  })

  it('discards a successful response from a superseded session', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')
    const oldPut = deferred<ReturnType<typeof ok>>()

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-1',
            session_id: 'session-1'
          })
        }
        if (config.method === 'POST' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-2',
            session_id: 'session-2'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return oldPut.promise
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    const write = NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    await tick()
    await NyarugramAdminManager.login(instance, 'default', 'secret')
    oldPut.resolve(ok({ version: '1' }))

    await expect(write).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
  })

  it('rejects a response whose session header differs from the captured session', async () => {
    const instance = makeInstance('a', 'https://a.example/admin/v1')

    requestMock.mockImplementation(
      async (config: { method: string; url: string }) => {
        if (config.method === 'GET' && config.url === '/session') {
          return ok({
            authenticated: true,
            csrf_token: 'csrf-1',
            session_id: 'session-1'
          })
        }
        if (config.method === 'PUT' && config.url === '/config') {
          return {
            data: { data: { version: '1' } },
            headers: { 'x-nyarugram-admin-session': 'session-2' }
          }
        }
        throw new Error(`unexpected request ${config.method} ${config.url}`)
      }
    )

    await NyarugramAdminManager.getSession(instance)
    await expect(
      NyarugramAdminManager.saveConfig(instance, saveRequest, '0')
    ).rejects.toBeInstanceOf(AdminOperationInvalidatedError)
  })
})
