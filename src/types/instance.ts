export type ProtocolKind = 'onebot11' | 'milky'

/**
 * 管理模式只保留 Nyarugram 统一管理接口与无管理接口的纯协议调试。
 * NapCat 专属管理客户端已移除。
 */
export type ManagementKind = 'nyarugram-admin-v1' | 'none'

export const managementKinds: readonly ManagementKind[] = [
  'nyarugram-admin-v1',
  'none'
]

export interface AdapterInstance {
  /** 稳定实例 ID，创建后不得随名称或入口变化。 */
  id: string
  name: string
  protocol: ProtocolKind
  managementKind: ManagementKind
  /** Nyarugram /admin/v1 基地址。managementKind=none 时为空。 */
  managementUrl: string
  /** 业务 HTTP 基地址：OneBot 的 OneBot HTTP 服务，或 Milky 适配器根地址。 */
  businessUrl: string
  /** 事件入口；OneBot 按实例实际 WebSocket 地址填写，Milky 为 /event。 */
  eventUrl: string
  createdAt: string
  updatedAt: string
}

export interface InstanceState {
  instances: AdapterInstance[]
  activeId: string
}

export const protocolLabels: Record<ProtocolKind, string> = {
  onebot11: 'OneBot V11',
  milky: 'Milky'
}

export const managementLabels: Record<ManagementKind, string> = {
  'nyarugram-admin-v1': 'Nyarugram /admin/v1',
  none: '仅协议调试'
}
