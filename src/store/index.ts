import { configureStore } from '@reduxjs/toolkit'

import instancesSlice from './modules/instances'

const store = configureStore({
  reducer: {
    instances: instancesSlice
  }
})

export default store

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
