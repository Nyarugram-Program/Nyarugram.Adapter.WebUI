const markerKey = (instanceId: string) =>
  `nyarugram.admin-session.${instanceId}`

const legacyMarkerKey = 'nyarugram.admin-session-active'

interface AdminSessionMarker {
  origin: string
}

const originOf = (managementUrl: string) => {
  try {
    return new URL(managementUrl).origin
  } catch {
    return ''
  }
}

/**
 * 管理会话 Cookie 由服务端按源持有，前端标记必须按实例隔离。标记只表示
 * “本标签页在该实例成功建立过会话”，不包含任何凭据；服务端 Cookie 才是
 * 授权的唯一依据。
 */
export const hasAdminSessionMarker = (
  instanceId: string,
  managementUrl: string
) => {
  if (!instanceId) return false
  try {
    const stored = sessionStorage.getItem(markerKey(instanceId))
    if (!stored) return false
    const marker = JSON.parse(stored) as Partial<AdminSessionMarker>
    const expected = originOf(managementUrl)
    return (
      typeof marker.origin === 'string' &&
      !!expected &&
      marker.origin === expected
    )
  } catch {
    return false
  }
}

export const setAdminSessionMarker = (
  instanceId: string,
  active: boolean,
  managementUrl: string
) => {
  if (!instanceId) return
  if (active) {
    const origin = originOf(managementUrl)
    if (!origin) return
    sessionStorage.setItem(markerKey(instanceId), JSON.stringify({ origin }))
  } else {
    sessionStorage.removeItem(markerKey(instanceId))
  }
}

/**
 * 旧版本使用全局标记。无法判断它属于哪个实例，直接丢弃并要求重新登录，
 * 避免把一个实例的登录状态显示到另一个实例。
 */
export const discardLegacyAdminSessionMarker = () => {
  localStorage.removeItem(legacyMarkerKey)
}
