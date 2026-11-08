const businessTokenKey = (instanceId: string) =>
  `nyarugram.instance.${instanceId}.businessToken`

const retiredNapcatTokenKey = (instanceId: string) =>
  `nyarugram.instance.${instanceId}.napcatToken`

const retiredOneBotDebugTokenKey = (instanceId: string) =>
  `nyarugram.instance.${instanceId}.onebot.businessToken`

export const getInstanceBusinessToken = (instanceId: string) => {
  if (!instanceId) return ''
  const current = sessionStorage.getItem(businessTokenKey(instanceId))
  const legacy = sessionStorage.getItem(retiredOneBotDebugTokenKey(instanceId))
  if (legacy !== null) {
    // Preserve a legitimate old business token once, while the current key
    // remains authoritative even when its value is explicitly empty.
    if (current === null) {
      sessionStorage.setItem(businessTokenKey(instanceId), legacy)
    }
    sessionStorage.removeItem(retiredOneBotDebugTokenKey(instanceId))
  }
  return current ?? legacy ?? ''
}

export const setInstanceBusinessToken = (instanceId: string, token: string) => {
  if (!instanceId) return
  if (token) {
    sessionStorage.setItem(businessTokenKey(instanceId), token)
  } else {
    sessionStorage.removeItem(businessTokenKey(instanceId))
  }
  sessionStorage.removeItem(retiredOneBotDebugTokenKey(instanceId))
}

export const clearInstanceSecrets = (instanceId: string) => {
  if (!instanceId) return
  setInstanceBusinessToken(instanceId, '')
  // NapCat 管理令牌只做清理，不能迁移为业务凭据。
  sessionStorage.removeItem(retiredNapcatTokenKey(instanceId))
}
