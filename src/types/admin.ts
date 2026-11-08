export interface AdminCapability {
  supported?: boolean
  reason?: string | null
  [key: string]: unknown
}

export interface AdminInfo {
  api_version: string
  instance_id: string
  adapter_kind: string
  adapter_version: string
  protocol_version: string
  capabilities: Record<string, AdminCapability>
  endpoints?: {
    management?: string
    business_http?: string
    events?: string
    media?: string
  }
}

export interface AdminSessionState {
  authenticated: boolean
  permissions?: string[]
  expires_at?: string
  csrf_token?: string
  /** 不透明管理会话 ID；用于区分同一会话刷新 CSRF 与新的登录会话。 */
  session_id?: string
}

export interface AdminAccount {
  account_id?: string
  display_name?: string
  username?: string
  gram_id?: string | null
  numeric_user_id?: string | null
  generation?: string
  avatar?: string | null
  state?: string
  reason?: string | null
}

export interface AdminSecretValue {
  state: 'keep' | 'replace' | 'clear'
  value?: string
}

export type AdminConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'secret'
  | 'readonly'

export interface AdminConfigOption {
  value: string | number | boolean
  label: string
}

export interface AdminConfigField {
  path: string
  label: string
  type: AdminConfigFieldType
  description?: string
  options?: AdminConfigOption[]
  requires_restart?: boolean
  min?: number
  max?: number
}

export interface AdminConfigSchema {
  version?: string
  fields: AdminConfigField[]
}

export interface AdminConfigSecretState {
  is_set: boolean
}

export interface AdminConfig {
  version: string
  values: Record<string, unknown>
  secrets?: Record<string, AdminConfigSecretState>
  applied_version?: string
  requires_restart?: boolean
}

export interface AdminConfigSaveRequest {
  values: Record<string, unknown>
  secrets: Record<string, AdminSecretValue>
}

export interface AdminConfigStatus {
  state: 'saved' | 'applied' | 'requires_restart' | 'failed' | string
  saved_version?: string
  applied_version?: string
  message?: string
}

export interface AdminLogEntry {
  id: string
  timestamp: string
  level: string
  source: string
  message: string
  /** 进程内日志序列身份；重启后 id 会重置，去重必须带上该值。 */
  stream_id?: string
  stream_started_at?: string
}

export interface AdminLogPage {
  entries: AdminLogEntry[]
  next_cursor?: string
  dropped?: number
  stream_id?: string
  stream_started_at?: string
}

export interface AdminMetrics {
  account?: {
    logged_in?: boolean
    display_name?: string | null
    numeric_user_id?: string | null
    generation?: string | null
  }
  backend?: {
    base_address?: string
    reachable?: boolean | null
    reason?: string | null
  }
  storage?: {
    state?: string
    healthy?: boolean | null
  }
  outbox?: {
    pending?: number
    expired?: number
    delivered?: number
    oldest_pending_at?: string | null
  }
  events?: {
    subscribers?: number
    consumers?: string[]
  }
  media?: {
    engine?: string
    available?: boolean
    audio?: boolean
    video?: boolean
    reason?: string | null
  }
  config?: {
    applied_version?: string
    saved_version?: string
    requires_restart?: boolean
  }
  [key: string]: unknown
}

export interface AdminError {
  code: string
  message: string
  request_id?: string
  fields?: Record<string, string>
}
