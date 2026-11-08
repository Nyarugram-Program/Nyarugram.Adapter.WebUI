import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  addInstance,
  removeInstance,
  selectActiveInstance,
  setActiveInstance,
  updateInstance
} from '@/store/modules/instances'

import { useAppDispatch, useAppSelector } from '@/hooks/use-store'

import { cancelServerRequests } from '@/utils/request'

import NyarugramAdminManager from '@/controllers/nyarugram_admin_manager'
import type { AdapterInstance } from '@/types/instance'

export interface InstanceContextValue {
  generation: number
  instances: AdapterInstance[]
  instance?: AdapterInstance
  selectInstance: (instanceId: string) => void
  upsertInstance: (instance: AdapterInstance) => void
  deleteInstance: (instanceId: string) => void
  /** 凭据变化或重新认证后调用，使旧请求与迟到结果失效。 */
  invalidate: () => void
}

const InstanceContext = createContext<InstanceContextValue | undefined>(
  undefined
)

const instanceKey = (instance?: AdapterInstance) =>
  instance
    ? [
        instance.id,
        instance.updatedAt,
        instance.protocol,
        instance.managementKind,
        instance.managementUrl,
        instance.businessUrl,
        instance.eventUrl
      ].join('|')
    : ''

export function InstanceProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const activeInstance = useAppSelector(selectActiveInstance)
  const allInstances = useAppSelector((state) => state.instances.instances)
  const [generation, setGeneration] = useState(0)
  const lastInstanceKey = useRef(instanceKey(activeInstance))

  const invalidate = useCallback(() => {
    cancelServerRequests()
    setGeneration((value) => value + 1)
  }, [])

  const selectInstance = useCallback(
    (instanceId: string) => {
      if (instanceId && instanceId !== activeInstance?.id) {
        if (activeInstance) {
          NyarugramAdminManager.invalidateSession(activeInstance.id)
        }
        cancelServerRequests()
        dispatch(setActiveInstance(instanceId))
      }
    },
    [activeInstance, dispatch]
  )

  const upsertInstance = useCallback(
    (instance: AdapterInstance) => {
      const existing = allInstances.find((item) => item.id === instance.id)
      if (existing) {
        if (
          existing.managementUrl !== instance.managementUrl ||
          existing.managementKind !== instance.managementKind
        ) {
          NyarugramAdminManager.invalidateSession(instance.id)
        }
        dispatch(updateInstance(instance))
      } else {
        dispatch(addInstance(instance))
      }
    },
    [allInstances, dispatch]
  )

  const deleteInstance = useCallback(
    (instanceId: string) => {
      NyarugramAdminManager.invalidateSession(instanceId)
      cancelServerRequests()
      dispatch(removeInstance(instanceId))
    },
    [dispatch]
  )

  useEffect(() => {
    const nextKey = instanceKey(activeInstance)
    if (nextKey !== lastInstanceKey.current) {
      lastInstanceKey.current = nextKey
      cancelServerRequests()
      setGeneration((value) => value + 1)
    }
  }, [activeInstance])

  const value = useMemo(
    () => ({
      generation,
      instances: allInstances,
      instance: activeInstance,
      selectInstance,
      upsertInstance,
      deleteInstance,
      invalidate
    }),
    [
      generation,
      allInstances,
      activeInstance,
      selectInstance,
      upsertInstance,
      deleteInstance,
      invalidate
    ]
  )

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  )
}

export const useInstanceContext = () => {
  const context = useContext(InstanceContext)
  if (!context) {
    throw new Error('useInstanceContext 必须在 InstanceProvider 内使用')
  }
  return context
}
