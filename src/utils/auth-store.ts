type Listener = () => void

let version = 0
const listeners = new Set<Listener>()

export const subscribeAuth = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getAuthSnapshot = () => version

/**
 * 登录、退出或凭据清理后调用。useAuth 使用 useSyncExternalStore 订阅，
 * 避免继续读取全局 localStorage 键。
 */
export const notifyAuthChanged = () => {
  version += 1
  listeners.forEach((listener) => listener())
}
