import { type PayloadAction, createSlice } from '@reduxjs/toolkit'

import key from '@/const/key'

import { discardLegacyAdminSessionMarker } from '@/utils/admin-session'
import { migrateLegacyNapcatToken } from '@/utils/instance-secrets'

import type { AdapterInstance, InstanceState } from '@/types/instance'

export const instancesStorageKey = 'nyarugram.adapter.instances.v1'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseStoredString = (value: string | null): string => {
  if (!value) return ''
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
}

const isHttpUrl = (value: string) => /^https?:\/\/[^\s/]+/i.test(value)

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '')

const readStoredState = (): InstanceState => {
  const storedValue = localStorage.getItem(instancesStorageKey)
  let storedInstances: AdapterInstance[] = []
  let storedActiveId = ''

  if (storedValue) {
    try {
      const parsed: unknown = JSON.parse(storedValue)
      if (isRecord(parsed)) {
        if (Array.isArray(parsed.instances)) {
          storedInstances = parsed.instances.filter(
            (item): item is AdapterInstance =>
              isRecord(item) &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              (item.protocol === 'onebot11' || item.protocol === 'milky') &&
              ['napcat', 'nyarugram-admin-v1', 'none'].includes(
                String(item.managementKind)
              )
          )
        }
        if (typeof parsed.activeId === 'string') {
          storedActiveId = parsed.activeId
        }
      }
    } catch {
      // 损坏数据按新登记处理，不回写秘密。
    }
  }

  if (storedInstances.length === 0) {
    const legacyUrl = normalizeUrl(
      parseStoredString(localStorage.getItem(key.storeURL))
    )

    if (isHttpUrl(legacyUrl)) {
      const now = new Date().toISOString()
      storedInstances = [
        {
          id: 'napcat-legacy',
          name: 'NapCat 实例',
          protocol: 'onebot11',
          managementKind: 'napcat',
          managementUrl: legacyUrl,
          businessUrl: '',
          eventUrl: '',
          createdAt: now,
          updatedAt: now
        }
      ]
      storedActiveId = storedInstances[0].id
    }
  }

  const activeId = storedInstances.some((item) => item.id === storedActiveId)
    ? storedActiveId
    : (storedInstances[0]?.id ?? '')

  const napcatInstanceIds = storedInstances
    .filter((item) => item.managementKind === 'napcat')
    .map((item) => item.id)
  const orderedNapcatIds =
    activeId && napcatInstanceIds.includes(activeId)
      ? [activeId, ...napcatInstanceIds.filter((id) => id !== activeId)]
      : napcatInstanceIds
  migrateLegacyNapcatToken(orderedNapcatIds)
  discardLegacyAdminSessionMarker()

  return {
    instances: storedInstances,
    activeId
  }
}

const persistState = (state: InstanceState) => {
  localStorage.setItem(instancesStorageKey, JSON.stringify(state))
}

const initialState = readStoredState()
persistState(initialState)

const instancesSlice = createSlice({
  name: 'instances',
  initialState,
  reducers: {
    addInstance(state, action: PayloadAction<AdapterInstance>) {
      if (state.instances.some((item) => item.id === action.payload.id)) {
        throw new Error('实例 ID 已存在')
      }
      state.instances.push(action.payload)
      if (!state.activeId) state.activeId = action.payload.id
      persistState(state)
    },
    updateInstance(state, action: PayloadAction<AdapterInstance>) {
      const index = state.instances.findIndex(
        (item) => item.id === action.payload.id
      )
      if (index === -1) return
      state.instances[index] = {
        ...action.payload,
        id: state.instances[index].id,
        createdAt: state.instances[index].createdAt
      }
      persistState(state)
    },
    removeInstance(state, action: PayloadAction<string>) {
      const index = state.instances.findIndex(
        (item) => item.id === action.payload
      )
      if (index === -1) return
      state.instances.splice(index, 1)
      if (state.activeId === action.payload) {
        state.activeId = state.instances[0]?.id ?? ''
      }
      persistState(state)
    },
    setActiveInstance(state, action: PayloadAction<string>) {
      if (!state.instances.some((item) => item.id === action.payload)) return
      state.activeId = action.payload
      persistState(state)
    }
  }
})

export const {
  addInstance,
  updateInstance,
  removeInstance,
  setActiveInstance
} = instancesSlice.actions

export const selectActiveInstance = (state: {
  instances: InstanceState
}): AdapterInstance | undefined =>
  state.instances.instances.find((item) => item.id === state.instances.activeId)

export default instancesSlice.reducer
