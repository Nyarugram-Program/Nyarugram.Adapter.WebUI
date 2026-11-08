import axios from 'axios'

import { selectActiveInstance } from '@/store/modules/instances'

import { notifyAuthChanged } from '@/utils/auth-store'
import { getNapcatToken, setNapcatToken } from '@/utils/instance-secrets'
import { getFullServerUrl } from '@/utils/url'

import store from '@/store'

export const serverRequest = axios.create({
  timeout: 5000
})

let serverAbortController = new AbortController()

export const cancelServerRequests = () => {
  serverAbortController.abort()
  serverAbortController = new AbortController()
}

export const request = axios.create({
  timeout: 10000
})

const activeNapcatToken = () => {
  const activeInstance = selectActiveInstance(store.getState())
  return activeInstance ? getNapcatToken(activeInstance.id) : ''
}

const clearRejectedToken = () => {
  const activeInstance = selectActiveInstance(store.getState())
  if (!activeInstance) return
  if (getNapcatToken(activeInstance.id)) {
    setNapcatToken(activeInstance.id, '')
    notifyAuthChanged()
  }
}

export const requestServerWithFetch = async (
  url: string,
  options: RequestInit
) => {
  const token = activeNapcatToken()

  if (token) {
    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`
    }
  }

  const baseURL = getFullServerUrl('/api')

  const response = await fetch(baseURL + url, options)

  return response
}

serverRequest.interceptors.request.use((config) => {
  const baseURL = getFullServerUrl('/api')

  config.signal = config.signal ?? serverAbortController.signal

  config.baseURL = baseURL

  const token = activeNapcatToken()

  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }

  return config
})

serverRequest.interceptors.response.use(
  (response) => {
    if (response.data.code !== 0) {
      if (response.data.message === 'Unauthorized') {
        clearRejectedToken()
      }
      throw new Error(response.data.message ?? 'NapCat 管理请求失败')
    }

    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      clearRejectedToken()
    }
    return Promise.reject(error)
  }
)
