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

import NyarugramAdminManager, {
  AdminOperationInvalidatedError
} from '@/controllers/nyarugram_admin_manager'

import useInstance from './use-instance'

const useAuth = () => {
  // 订阅登录状态变化，替代旧的全局登录标记。
  useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot)
  const { instance, invalidate } = useInstance()

  const isAuth = instance
    ? instance.managementKind === 'none' ||
      hasAdminSessionMarker(instance.id, instance.managementUrl)
    : false

  const revokeAuth = useCallback(async () => {
    if (!instance) return
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
    isAuth,
    revokeAuth
  }
}

export default useAuth
