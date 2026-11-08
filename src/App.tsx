import { Suspense, lazy } from 'react'
import { Provider } from 'react-redux'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams
} from 'react-router-dom'

import PageBackground from '@/components/page_background'
import PageLoading from '@/components/page_loading'
import Toaster from '@/components/toaster'

import DialogProvider from '@/contexts/dialog'
import { InstanceProvider } from '@/contexts/instance'

import useAuth from '@/hooks/auth'

import store from '@/store'

const WebLoginPage = lazy(() => import('@/pages/web_login'))
const IndexPage = lazy(() => import('@/pages/index'))
const QQLoginPage = lazy(() => import('@/pages/qq_login'))
const InstancesPage = lazy(() => import('@/pages/instances'))

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
  const [searchParams] = useSearchParams()
  const location = useLocation()

  // 登录页和实例登记页必须在未认证时可访问；否则 /web_login 会重定向到自身。
  if (
    isAuth ||
    location.pathname === '/instances' ||
    location.pathname === '/web_login'
  ) {
    return <>{children}</>
  }

  const token = searchParams.get('token')
  const back = searchParams.get('back') ?? ''
  const query = new URLSearchParams()

  if (token) query.set('token', token)
  if (back) query.set('back', back)

  const suffix = query.size > 0 ? `?${query.toString()}` : ''

  return <Navigate replace to={`/web_login${suffix}`} />
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<IndexPage />} path="/*" />
      <Route element={<QQLoginPage />} path="/qq_login" />
      <Route element={<WebLoginPage />} path="/web_login" />
      <Route element={<InstancesPage />} path="/instances" />
    </Routes>
  )
}

export default App
