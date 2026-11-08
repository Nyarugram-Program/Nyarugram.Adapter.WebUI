import { AxiosResponse } from 'axios'

import { selectActiveInstance } from '@/store/modules/instances'

import store from '@/store'

/**
 * 打开链接
 * @param url 链接地址
 * @param newTab 是否在新标签页打开
 */
export function openUrl(url: string, newTab = true) {
  if (newTab) {
    window.open(url)
  } else {
    window.location.href = url
  }
}

/**
 * 获取完整的服务器地址
 * @param path 路径
 */
export const getFullServerUrl = (path: string) => {
  const activeInstance = selectActiveInstance(store.getState())

  if (!activeInstance) {
    throw new Error('尚未登记适配器实例')
  }
  if (activeInstance.managementKind !== 'napcat') {
    throw new Error('当前实例不是 NapCat 管理模式')
  }
  if (!activeInstance.managementUrl) {
    throw new Error('实例未配置 NapCat 管理地址')
  }

  const storeURL = activeInstance.managementUrl

  return `${storeURL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * 将Axios的响应转换为标准的HTTP报文
 * @param response Axios响应
 * @returns 标准的HTTP报文
 */
export function parseAxiosResponse(
  response: AxiosResponse,
  http_version: string = 'HTTP/1.1'
) {
  if (!response?.status) {
    return 'No response'
  }
  const statusLine = `${http_version} ${response.status} ${response.statusText}`
  const headers = Object.entries(response.headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n')
  const body = response.data
    ? `\r\n\r\n${typeof response.data === 'string' ? JSON.stringify(JSON.parse(response.data), null, 2) : JSON.stringify(response.data, null, 2)}`
    : ''
  return `${statusLine}\r\n${headers}${body}`
}

/**
 * 判断是否为URI
 * @param uri URI
 * @returns 是否为URI
 */
export const isURI = (uri: string) => {
  return /^(http|https|file):\/\/.*/.test(uri)
}
