import type {
  AdapterInstance,
  InstanceState,
  ManagementKind,
  ProtocolKind
} from '@/types/instance'

export const instancesStorageKey = 'nyarugram.adapter.instances.v1'

const retiredManagementKind = 'napcat'
const retiredGlobalKeys = ['token', 'storeURL'] as const
const retiredAdminSessionKey = 'nyarugram.admin-session-active'
const retiredNapcatTokenKeyPattern = /^nyarugram\.instance\..+\.napcatToken$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isProtocol = (value: unknown): value is ProtocolKind =>
  value === 'onebot11' || value === 'milky'

const isManagementKind = (value: string): value is ManagementKind =>
  value === 'nyarugram-admin-v1' || value === 'none'

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '')

const readString = (value: unknown) => (typeof value === 'string' ? value : '')

const readIsoDate = (value: unknown, fallback: string) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : fallback

export interface PersistedInstanceState extends InstanceState {
  /** 本次读取是否重写或丢弃了任何旧字段。 */
  changed: boolean
  /** 本次从 NapCat 管理模式迁移的稳定实例 ID。 */
  migratedInstanceIds: string[]
}

interface MigratedRecord {
  instance?: AdapterInstance
  changed: boolean
  migrated: boolean
}

const migrateRecord = (item: unknown, now: string): MigratedRecord => {
  if (!isRecord(item)) return { changed: true, migrated: false }

  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const name = typeof item.name === 'string' ? item.name : ''
  if (!id || !name.trim() || !isProtocol(item.protocol)) {
    return { changed: true, migrated: false }
  }

  const createdAt = readIsoDate(item.createdAt, now)
  const updatedAt = readIsoDate(item.updatedAt, createdAt)
  const rawManagementKind = readString(item.managementKind)
  const businessUrl = normalizeUrl(readString(item.businessUrl))
  const eventUrl = normalizeUrl(readString(item.eventUrl))

  if (rawManagementKind === retiredManagementKind) {
    // 旧 NapCat 管理实例只保留稳定 ID、名称和用户显式填写的业务入口。
    // 管理地址不是业务地址，不能据此推断或复制端口与路径；NapCat 管理
    // 凭据也不迁移为 OneBot 业务凭据。
    return {
      instance: {
        id,
        name,
        protocol: item.protocol,
        managementKind: 'none',
        managementUrl: '',
        businessUrl,
        eventUrl,
        createdAt,
        updatedAt: now
      },
      changed: true,
      migrated: true
    }
  }

  if (!isManagementKind(rawManagementKind)) {
    return { changed: true, migrated: false }
  }

  const rawManagementUrl = readString(item.managementUrl)
  const managementUrl =
    rawManagementKind === 'none' ? '' : normalizeUrl(rawManagementUrl)

  return {
    instance: {
      id,
      name,
      protocol: item.protocol,
      managementKind: rawManagementKind,
      managementUrl,
      businessUrl,
      eventUrl,
      createdAt,
      updatedAt
    },
    changed:
      managementUrl !== rawManagementUrl ||
      businessUrl !== readString(item.businessUrl) ||
      eventUrl !== readString(item.eventUrl),
    migrated: false
  }
}

/**
 * 把浏览器中保存的实例列表转换为当前支持的格式。迁移可以重复执行：
 * 第二次读取已迁移的数据不会再次改变 updatedAt，也不会产生新的迁移 ID。
 * 无法识别的条目被丢弃，而不是猜测其管理入口。
 */
export const migrateStoredInstanceState = (
  raw: string | null,
  now: string = new Date().toISOString()
): PersistedInstanceState => {
  let parsed: unknown
  let changed = false

  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      changed = true
    }
  } else {
    changed = true
  }

  if (!isRecord(parsed)) {
    return {
      instances: [],
      activeId: '',
      changed: true,
      migratedInstanceIds: []
    }
  }

  const rawInstances = Array.isArray(parsed.instances) ? parsed.instances : []
  if (!Array.isArray(parsed.instances)) changed = true

  const instances: AdapterInstance[] = []
  const migratedInstanceIds: string[] = []
  const seenIds = new Set<string>()

  for (const item of rawInstances) {
    const result = migrateRecord(item, now)
    changed = changed || result.changed
    if (!result.instance) continue
    if (seenIds.has(result.instance.id)) {
      changed = true
      continue
    }
    seenIds.add(result.instance.id)
    instances.push(result.instance)
    if (result.migrated) migratedInstanceIds.push(result.instance.id)
  }

  const requestedActiveId =
    typeof parsed.activeId === 'string' ? parsed.activeId : ''
  const activeId = instances.some((item) => item.id === requestedActiveId)
    ? requestedActiveId
    : (instances[0]?.id ?? '')
  if (activeId !== requestedActiveId) changed = true

  return { instances, activeId, changed, migratedInstanceIds }
}

export const persistInstanceState = (state: InstanceState) => {
  localStorage.setItem(
    instancesStorageKey,
    JSON.stringify({
      instances: state.instances,
      activeId: state.activeId
    })
  )
}

/**
 * 清除 NapCat 管理时代留下的凭据、地址和登录标记。它们不再有任何用途，
 * 也不能被解释成业务凭据；其他实例的业务令牌和事件游标不受影响。
 */
export const purgeRetiredNapcatState = () => {
  retiredGlobalKeys.forEach((retiredKey) => localStorage.removeItem(retiredKey))
  localStorage.removeItem(retiredAdminSessionKey)

  const retiredSessionKeys: string[] = []
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const storageKey = sessionStorage.key(index)
    if (storageKey && retiredNapcatTokenKeyPattern.test(storageKey)) {
      retiredSessionKeys.push(storageKey)
    }
  }
  retiredSessionKeys.forEach((retiredKey) =>
    sessionStorage.removeItem(retiredKey)
  )
}

export const readPersistedInstanceState = (): PersistedInstanceState => {
  const state = migrateStoredInstanceState(
    localStorage.getItem(instancesStorageKey)
  )
  persistInstanceState(state)
  purgeRetiredNapcatState()
  return state
}
