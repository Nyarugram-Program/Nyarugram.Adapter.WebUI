import { type PayloadAction, createSlice } from '@reduxjs/toolkit'

import {
  persistInstanceState,
  readPersistedInstanceState
} from '@/utils/instance-storage'

import type { AdapterInstance, InstanceState } from '@/types/instance'

const persisted = readPersistedInstanceState()
const initialState: InstanceState = {
  instances: persisted.instances,
  activeId: persisted.activeId
}

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
      persistInstanceState(state)
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
      persistInstanceState(state)
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
      persistInstanceState(state)
    },
    setActiveInstance(state, action: PayloadAction<string>) {
      if (!state.instances.some((item) => item.id === action.payload)) return
      state.activeId = action.payload
      persistInstanceState(state)
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
