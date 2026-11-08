import { Suspense, lazy } from 'react'
import { Provider } from 'react-redux'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import PageBackground from '@/components/page_background'
import PageLoading from '@/components/page_loading'
import Toaster from '@/components/toaster'

import DialogProvider from '@/contexts/dialog'
import { InstanceProvider } from '@/contexts/instance'

import useAuth from '@/hooks/auth'

import store from '@/store'

const WebLoginPage = lazy(() => import('@/pages/web_login'))
const IndexPage = lazy(() => import('@/pages/index'))
const InstancesPage = lazy(() => import('@/pages/instances'))
const RemovedRoutePage = lazy(() => import('@/pages/removed_route'))

function App() {
  return (
    <DialogProvider>
      <Provider store={store}>
        <InstanceProvider>
          <PageBackground />
          <Toaster />
          <Suspense fallback={<PageLoading />}>
            <AuthChecker>
              <AppRoutes />
            </AuthChecker>
          </Suspense>
        </InstanceProvider>
      </Provider>
    </DialogProvider>
  )
}

function AuthChecker({ children }: { children: React.ReactNode }) {
  const { isAuth } = useAuth()
  const location = useLocation()

  // 登录页、实例登记页和已移除入口必须可直接访问，否则深链接会被重定向。
  if (
    isAuth ||
    location.pathname === '/instances' ||
    location.pathname === '/web_login' ||
    location.pathname === '/qq_login'
  ) {
    return <>{children}</>
  }

  const back = `${location.pathname}${location.search}`
  return <Navigate replace to={`/web_login?back=${encodeURIComponent(back)}`} />
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<IndexPage />} path="/*" />
      <Route element={<RemovedRoutePage />} path="/qq_login" />
      <Route element={<WebLoginPage />} path="/web_login" />
      <Route element={<InstancesPage />} path="/instances" />
    </Routes>
  )
}

export default App
