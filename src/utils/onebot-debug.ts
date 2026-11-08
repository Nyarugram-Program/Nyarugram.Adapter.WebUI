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

/** OneBot 调试与实例登记共用业务令牌的迁移、替换和清除逻辑。 */
export const getOneBotBusinessToken = getInstanceBusinessToken

export const setOneBotBusinessToken = setInstanceBusinessToken
