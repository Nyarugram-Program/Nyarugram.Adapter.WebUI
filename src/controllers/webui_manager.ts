import { EventSourcePolyfill } from 'event-source-polyfill'

import { LogLevel } from '@/const/enum'
import { selectActiveInstance } from '@/store/modules/instances'
import store from '@/store'

import { getNapcatToken } from '@/utils/instance-secrets'
import { serverRequest } from '@/utils/request'
import { getFullServerUrl } from '@/utils/url'

export interface Log {
  level: LogLevel
  message: string
}

const activeNapcatToken = () => {
  const activeInstance = selectActiveInstance(store.getState())
  if (!activeInstance) throw new Error('尚未登记适配器实例')
  if (activeInstance.managementKind !== 'napcat') {
    throw new Error('当前实例不是 NapCat 管理模式')
  }
  const token = getNapcatToken(activeInstance.id)
  if (!token) throw new Error('未登录')
  return token
}

export default class WebUIManager {
  public static async checkWebUiLogined() {
    const { data } =
      await serverRequest.post<ServerResponse<boolean>>('/auth/check')
    return data.data
  }

  public static async loginWithToken(token: string) {
    const { data } = await serverRequest.post<ServerResponse<AuthResponse>>(
      '/auth/login',
      { token }
    )
    return data.data.Credential
  }

  public static async getPackageInfo() {
    const { data } =
      await serverRequest.get<ServerResponse<PackageInfo>>('/base/PackageInfo')
    return data.data
  }

  public static async getQQVersion() {
    const { data } =
      await serverRequest.get<ServerResponse<string>>('/base/QQVersion')
    return data.data
  }

  public static async getLogList() {
    const { data } =
      await serverRequest.get<ServerResponse<string[]>>('/Log/GetLogList')
    return data.data
  }

  public static async getLogContent(logName: string) {
    const { data } = await serverRequest.get<ServerResponse<string>>(
      `/Log/GetLog?id=${logName}`
    )
    return data.data
  }

  public static getRealTimeLogs(writer: (data: Log[]) => void) {
    const _token = activeNapcatToken()
    const eventSource = new EventSourcePolyfill(
      getFullServerUrl('/api/Log/GetLogRealTime'),
      {
        headers: {
          Authorization: `Bearer ${_token}`,
          Accept: 'text/event-stream'
        },
        withCredentials: true
      }
    )

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        data.message = data.message.replace(/\n/g, '\r\n')
        writer([data])
      } catch (error) {
        console.error(error)
      }
    }

    eventSource.onerror = (error) => {
      console.error('SSE连接出错:', error)
      eventSource.close()
    }

    return eventSource
  }

  public static getSystemStatus(writer: (data: SystemStatus) => void) {
    const _token = activeNapcatToken()
    const eventSource = new EventSourcePolyfill(
      getFullServerUrl('/api/base/GetSysStatusRealTime'),
      {
        headers: {
          Authorization: `Bearer ${_token}`,
          Accept: 'text/event-stream'
        },
        withCredentials: true
      }
    )

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SystemStatus
        writer(data)
      } catch (error) {
        console.error(error)
      }
    }

    eventSource.onerror = (error) => {
      console.error('SSE连接出错:', error)
      eventSource.close()
    }

    return eventSource
  }
}
