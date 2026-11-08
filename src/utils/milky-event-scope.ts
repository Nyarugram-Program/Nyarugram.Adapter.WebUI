import type { AdapterInstance } from '@/types/instance'

import type { EventTransport } from './milky-events'

export interface EventAccountIdentity {
  /** 稳定的账号作用域标识，例如 admin:<uuid> 或 business:<uin>。 */
  value: string
  /** 页面展示用的账号说明，不参与游标键。 */
  label: string
}

export interface EventScope {
  /** 完整消费作用域；持久化游标只认这个值。 */
  key: string
  instanceId: string
  protocol: string
  transport: EventTransport
  consumer: string
  serviceIdentity: string
  accountIdentity: string
  accountLabel: string
}

const normalizeEndpoint = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host}${path}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

/**
 * Service identity is deliberately based on explicit endpoints, not on a process
 * GUID: a normal adapter restart keeps the recovery position, while changing a
 * management/business/event entry starts a new cursor scope.
 */
export const buildServiceIdentity = (instance: AdapterInstance) =>
  [
    normalizeEndpoint(instance.managementUrl),
    normalizeEndpoint(instance.businessUrl),
    normalizeEndpoint(instance.eventUrl)
  ]
    .filter(Boolean)
    .join('|')

export const normalizeConsumer = (value: string) => {
  const trimmed = value.trim()
  return trimmed || 'nyarugram-webui'
}

const stableScope = (parts: Record<string, string>) =>
  Object.entries(parts)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

export const buildEventScope = (input: {
  instance: AdapterInstance
  transport: EventTransport
  consumer: string
  account: EventAccountIdentity
}): EventScope => {
  const consumer = normalizeConsumer(input.consumer)
  const serviceIdentity = buildServiceIdentity(input.instance)
  const key = stableScope({
    version: '3',
    instance: input.instance.id,
    protocol: input.instance.protocol,
    service: serviceIdentity,
    account: input.account.value,
    consumer,
    transport: input.transport
  })

  return {
    key,
    instanceId: input.instance.id,
    protocol: input.instance.protocol,
    transport: input.transport,
    consumer,
    serviceIdentity,
    accountIdentity: input.account.value,
    accountLabel: input.account.label
  }
}

const accountValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export const adminEventAccount = (account: {
  account_id?: string
  display_name?: string
  numeric_user_id?: string | null
  state?: string
  reason?: string | null
}): EventAccountIdentity | { reason: string } => {
  if (account.state && account.state !== 'active') {
    return {
      reason:
        account.reason ??
        `后端账号状态为 ${account.state}，无法确定事件消费身份`
    }
  }
  const accountId = accountValue(account.account_id)
  if (!accountId) {
    return { reason: '管理接口没有返回稳定的后端账号 ID' }
  }
  const numeric = accountValue(account.numeric_user_id)
  const label = account.display_name
    ? `${account.display_name}${numeric ? ` (${numeric})` : ''}`
    : (numeric ?? accountId)
  return { value: `admin:${accountId}`, label }
}

export const businessEventAccount = (
  loginInfo: { uin?: unknown; nickname?: string } | null | undefined
): EventAccountIdentity | { reason: string } => {
  const uin = accountValue(loginInfo?.uin)
  if (!uin) {
    return { reason: '业务接口没有返回可用的登录账号 uin' }
  }
  return {
    value: `business:${uin}`,
    label: loginInfo?.nickname ? `${loginInfo.nickname} (${uin})` : uin
  }
}
