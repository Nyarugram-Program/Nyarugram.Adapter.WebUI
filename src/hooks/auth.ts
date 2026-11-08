import { useCallback, useSyncExternalStore } from 'react'

import {
  hasAdminSessionMarker,
  setAdminSessionMarker
} from '@/utils/admin-session'
import {
  getAuthSnapshot,
  notifyAuthChanged,
  subscribeAuth
} from '@/utils/auth-store'
import { getNapcatToken, setNapcatToken } from '@/utils/instance-secrets'

import NyarugramAdminManager, {
  AdminOperationInvalidatedError
} from '@/controllers/nyarugram_admin_manager'

import useInstance from './use-instance'

const useAuth = () => {
  // 订阅登录状态变化，替代 useLocalStorage 的全局 token。
  useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot)
  const { instance, invalidate } = useInstance()

  const napcatToken = instance ? getNapcatToken(instance.id) : ''
  const isAuth = instance
    ? instance.managementKind === 'none'
      ? true
      : instance.managementKind === 'napcat'
        ? !!napcatToken
        : instance.managementKind === 'nyarugram-admin-v1'
          ? hasAdminSessionMarker(instance.id, instance.managementUrl)
          : false
    : false

  const revokeAuth = useCallback(async () => {
    if (!instance) return
    if (instance.managementKind === 'napcat') {
      setNapcatToken(instance.id, '')
    }
    if (instance.managementKind === 'nyarugram-admin-v1') {
      try {
        await NyarugramAdminManager.logout(instance)
      } catch (error) {
        if (error instanceof AdminOperationInvalidatedError) {
          // A newer login (or another instance) owns the session now; do not
          // clear its marker or claim this logout succeeded.
          return
        }
        // 服务端会话可能已经失效；本地标记仍需清除。
      }
      setAdminSessionMarker(instance.id, false, instance.managementUrl)
    }
    invalidate()
    notifyAuthChanged()
  }, [instance, invalidate])

  return {
    token: napcatToken,
    isAuth,
    revokeAuth
  }
}

export default useAuth
