import {
  getInstanceBusinessToken,
  setInstanceBusinessToken
} from './instance-secrets'

const key = (instanceId: string, name: string) =>
  `nyarugram.instance.${instanceId}.onebot.${name}`

export const getOneBotBusinessUrl = (instanceId: string) =>
  localStorage.getItem(key(instanceId, 'businessUrl')) ?? ''

export const setOneBotBusinessUrl = (instanceId: string, value: string) => {
  if (value) localStorage.setItem(key(instanceId, 'businessUrl'), value)
  else localStorage.removeItem(key(instanceId, 'businessUrl'))
}

/**
 * OneBot 调试与实例登记共用同一份按实例隔离的业务令牌。旧调试页曾使用
 * 独立的 onebot.businessToken 键，读取时兼容但写入后立即迁移。
 */
export const getOneBotBusinessToken = (instanceId: string) =>
  getInstanceBusinessToken(instanceId) ||
  sessionStorage.getItem(key(instanceId, 'businessToken')) ||
  ''

export const setOneBotBusinessToken = (instanceId: string, value: string) => {
  setInstanceBusinessToken(instanceId, value)
  sessionStorage.removeItem(key(instanceId, 'businessToken'))
}
