import axios from 'axios'

import { parseJson, stringifyJson } from '@/utils/json'

import type { AdapterInstance } from '@/types/instance'
import type {
  MilkyCapabilities,
  MilkyHealth,
  MilkyResponse
} from '@/types/milky'

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

const parseRetryAfter = (headers: unknown): number | undefined => {
  if (!headers || typeof headers !== 'object') return undefined
  const raw = (headers as Record<string, unknown>)['retry-after']
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

export class MilkyRequestError extends Error {
  status?: number
  retcode?: number
  network: boolean
  timeout: boolean
  retryAfterMs?: number

  constructor(
    message: string,
    options: {
      status?: number
      retcode?: number
      network?: boolean
      timeout?: boolean
      retryAfterMs?: number
    } = {}
  ) {
    super(message)
    this.name = 'MilkyRequestError'
    this.status = options.status
    this.retcode = options.retcode
    this.network = options.network ?? false
    this.timeout = options.timeout ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

const toErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status) return `HTTP ${status}：${error.message}`
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

interface MilkyHttpResponse<T> {
  body: MilkyResponse<T>
  status: number
  retryAfterMs?: number
}

export default class MilkyManager {
  public static async call<T = unknown>(
    instance: AdapterInstance,
    token: string,
    action: string,
    params: unknown = {},
    signal?: AbortSignal
  ): Promise<MilkyResponse<T>> {
    const response = await this.request<T>(
      instance,
      token,
      action,
      params,
      signal
    )
    return response.body
  }

  private static async request<T>(
    instance: AdapterInstance,
    token: string,
    action: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<MilkyHttpResponse<T>> {
    const businessUrl = normalizeBaseUrl(instance.businessUrl)
    if (!/^https?:\/\//i.test(businessUrl)) {
      throw new MilkyRequestError('实例未配置有效的 Milky 业务 HTTP 地址')
    }

    let bodyText: string
    try {
      bodyText = stringifyJson(params)
    } catch (error) {
      throw new Error(`请求体序列化失败：${toErrorMessage(error)}`)
    }

    let response
    try {
      response = await axios.post<string>(
        `${businessUrl}/api/${encodeURIComponent(action)}`,
        bodyText,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          responseType: 'text',
          signal,
          transformRequest: (data) => data,
          validateStatus: () => true
        }
      )
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new MilkyRequestError(
          `Milky 请求失败：${toErrorMessage(error)}`,
          {
            status: error.response?.status,
            network: !error.response,
            timeout:
              error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT',
            retryAfterMs: parseRetryAfter(error.response?.headers)
          }
        )
      }
      throw new MilkyRequestError(`Milky 请求失败：${toErrorMessage(error)}`)
    }

    const metadata = {
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers)
    }

    if (response.status === 401) {
      throw new MilkyRequestError('HTTP 401：业务访问令牌无效或实例未登录', {
        ...metadata
      })
    }
    if (response.status === 404) {
      throw new MilkyRequestError(`HTTP 404：实例未暴露动作 ${action}`, {
        ...metadata
      })
    }

    let parsed: unknown
    try {
      parsed = parseJson(response.data)
    } catch {
      throw new MilkyRequestError(
        `实例返回了非 JSON 响应：HTTP ${response.status} ${response.data.slice(0, 200)}`,
        metadata
      )
    }

    const envelope = parsed as Partial<MilkyResponse<T>> | null
    if (
      !envelope ||
      (envelope.status !== 'ok' && envelope.status !== 'failed') ||
      typeof envelope.retcode !== 'number'
    ) {
      throw new MilkyRequestError('实例响应缺少 Milky status/retcode 外壳', {
        ...metadata
      })
    }

    return { body: envelope as MilkyResponse<T>, ...metadata }
  }

  public static async getCapabilities(
    instance: AdapterInstance,
    token: string,
    signal?: AbortSignal
  ) {
    const response = await this.call<MilkyCapabilities>(
      instance,
      token,
      'nyarugram_get_capabilities',
      {},
      signal
    )
    if (response.status !== 'ok' || !response.data) {
      throw new Error(response.message ?? '查询能力失败')
    }
    return response.data
  }

  public static async getLoginInfo(
    instance: AdapterInstance,
    token: string,
    signal?: AbortSignal
  ) {
    const response = await this.request<{ uin?: unknown; nickname?: string }>(
      instance,
      token,
      'get_login_info',
      {},
      signal
    )
    const body = response.body
    if (response.status >= 400 || body.status !== 'ok' || !body.data) {
      throw new MilkyRequestError(body.message ?? '查询登录账号失败', {
        status: response.status,
        retcode: body.retcode,
        retryAfterMs: response.retryAfterMs
      })
    }
    return body.data
  }

  public static async getHealth(
    instance: AdapterInstance,
    signal?: AbortSignal
  ): Promise<MilkyHealth> {
    const businessUrl = normalizeBaseUrl(instance.businessUrl)
    if (!/^https?:\/\//i.test(businessUrl)) {
      throw new MilkyRequestError('实例未配置有效的 Milky 业务 HTTP 地址')
    }
    try {
      const response = await axios.get<string>(`${businessUrl}/health`, {
        responseType: 'text',
        signal,
        validateStatus: () => true
      })
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`)
      }
      return parseJson(response.data) as MilkyHealth
    } catch (error) {
      throw new Error(`健康检查失败：${toErrorMessage(error)}`)
    }
  }
}
