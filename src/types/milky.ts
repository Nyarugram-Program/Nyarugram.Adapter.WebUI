export interface MilkyResponse<T = unknown> {
  status: 'ok' | 'failed'
  retcode: number
  data: T | null
  message: string | null
}

export interface MilkyHealth {
  status: 'ok' | 'degraded' | 'unhealthy' | string
  storage?: 'ok' | 'unhealthy' | string
  logged_in?: boolean
  uin?: number | string | null
  generation?: number | string
  instance?: string
  media_engine?: string
  media_available?: boolean
  event_subscribers?: number
  event_consumers?: number
  outbox_pending?: number
  outbox_expired?: number
  outbox_oldest_pending?: number | null
}

export interface MilkyCapabilities {
  extension_version?: number
  impl_name?: string
  impl_version?: string
  milky_version?: string
  platform?: string
  backend_protocol_major?: number
  backend_protocol_sha256?: string
  milky_schema_sha256?: string
  apis?: string[]
  events?: string[]
  message_segments?: string[]
  message_scenes?: string[]
  calls?: {
    control?: boolean
    voice?: boolean
    video?: boolean
    auto_answer?: boolean
    reason?: string | null
  }
  media?: {
    transport?: string
    path?: string
    engine?: string
    opus_inbound?: boolean
    pcm_outbound?: boolean
  }
  limitations?: string[]
}

export interface MilkyEventFrame {
  time?: number
  self_id?: number | string
  event_type?: string
  data?: Record<string, unknown>
}

export interface MilkyWsExtensionFrame {
  type?: string
  extension_version?: number
  epoch?: number
  seq?: number
  event_id?: string
  event_type?: string
  event?: MilkyEventFrame
  cursor?: number
  requested_cursor?: number
  oldest_available?: number
  consumer?: string
  action?: string
}
