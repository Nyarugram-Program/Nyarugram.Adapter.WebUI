export type ProtocolKind = 'onebot11' | 'milky'

export type ManagementKind = 'napcat' | 'nyarugram-admin-v1' | 'none'

export interface AdapterInstance {
  /** 稳定实例 ID，创建后不得随名称或入口变化。 */
  id: string
  name: string
  protocol: ProtocolKind
  managementKind: ManagementKind
  /** NapCat 管理地址，或 Nyarugram /admin/v1 基地址。managementKind=none 时为空。 */
  managementUrl: string
  /** 业务 HTTP 基地址；OneBot 通常为 NapCat 业务入口，Milky 为适配器根地址。 */
  businessUrl: string
  /** Milky 事件入口；OneBot 由适配器配置决定时可留空，但不得静默猜测。 */
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
  napcat: 'NapCat 管理',
  'nyarugram-admin-v1': 'Nyarugram /admin/v1',
  none: '仅协议调试'
}
