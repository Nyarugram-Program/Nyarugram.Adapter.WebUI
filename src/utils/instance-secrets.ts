const businessTokenKey = (instanceId: string) =>
  `nyarugram.instance.${instanceId}.businessToken`

const napcatTokenKey = (instanceId: string) =>
  `nyarugram.instance.${instanceId}.napcatToken`

const legacyNapcatTokenKey = 'token'

const readLegacyToken = () => {
  try {
    const stored = localStorage.getItem(legacyNapcatTokenKey)
    if (!stored) return ''
    const parsed: unknown = JSON.parse(stored)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
}

export const getInstanceBusinessToken = (instanceId: string) =>
  instanceId ? (sessionStorage.getItem(businessTokenKey(instanceId)) ?? '') : ''

export const setInstanceBusinessToken = (instanceId: string, token: string) => {
  if (!instanceId) return
  if (token) {
    sessionStorage.setItem(businessTokenKey(instanceId), token)
  } else {
    sessionStorage.removeItem(businessTokenKey(instanceId))
  }
}

export const getNapcatToken = (instanceId: string) =>
  instanceId ? (sessionStorage.getItem(napcatTokenKey(instanceId)) ?? '') : ''

export const setNapcatToken = (instanceId: string, token: string) => {
  if (!instanceId) return
  if (token) {
    sessionStorage.setItem(napcatTokenKey(instanceId), token)
  } else {
    sessionStorage.removeItem(napcatTokenKey(instanceId))
  }
}

/**
 * 旧版本把 NapCat 令牌和 storeURL 放在全局 localStorage。实例化后只把令牌
 * 迁移到对应实例的 sessionStorage，并删除全局副本，避免跨实例误用。
 */
export const migrateLegacyNapcatToken = (candidateInstanceIds: string[]) => {
  const token = readLegacyToken()
  if (token) {
    const target = candidateInstanceIds.find(
      (instanceId) => !sessionStorage.getItem(napcatTokenKey(instanceId))
    )
    if (target) sessionStorage.setItem(napcatTokenKey(target), token)
  }
  localStorage.removeItem(legacyNapcatTokenKey)
}

export const clearInstanceSecrets = (instanceId: string) => {
  if (!instanceId) return
  sessionStorage.removeItem(businessTokenKey(instanceId))
  sessionStorage.removeItem(napcatTokenKey(instanceId))
  // 旧 OneBot 调试页使用的独立令牌键。
  sessionStorage.removeItem(
    `nyarugram.instance.${instanceId}.onebot.businessToken`
  )
}
