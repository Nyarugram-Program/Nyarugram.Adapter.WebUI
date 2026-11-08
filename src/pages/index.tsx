import { Route, Routes } from 'react-router-dom'

import AdminConfigPage from '@/components/admin/config'
import AdminLogsPage from '@/components/admin/logs'
import AdminOverviewPage from '@/components/admin/overview'
import CapabilityUnavailable from '@/components/instance/unavailable'
import MilkyCallsPage from '@/components/milky/calls'
import MilkyEventDebug from '@/components/milky/event_debug'
import MilkyHttpDebug from '@/components/milky/http_debug'
import MilkyOverviewPage from '@/components/milky/overview'
import OneBotOverviewPage from '@/components/onebot/overview'

import useInstance from '@/hooks/use-instance'

import DefaultLayout from '@/layouts/default'

import AboutPage from './dashboard/about'
import DebugPage from './dashboard/debug'
import HttpDebug from './dashboard/debug/http'
import WSDebug from './dashboard/debug/websocket'

const unavailable = (title: string, reason: string) => (
  <CapabilityUnavailable reason={reason} title={title} />
)

export default function IndexPage() {
  const { instance, generation } = useInstance()
  const isMilky = instance?.protocol === 'milky'
  const isAdmin = instance?.managementKind === 'nyarugram-admin-v1'

  const overview = isAdmin ? (
    <AdminOverviewPage />
  ) : isMilky ? (
    <MilkyOverviewPage />
  ) : (
    <OneBotOverviewPage />
  )

  return (
    <DefaultLayout
      key={`${instance?.id ?? 'no-instance'}-${instance?.updatedAt ?? ''}-${generation}`}
    >
      <Routes>
        <Route element={overview} path="/" />
        <Route
          element={
            isAdmin
              ? unavailable(
                  '网络配置不可用',
                  'Nyarugram /admin/v1 未提供网络传输配置；监听地址由适配器或部署配置管理，前端不会根据端口推断入口。'
                )
              : unavailable(
                  '网络配置不可用',
                  isMilky
                    ? 'Milky 的监听与事件配置由适配器管理，本版本没有对应管理接口。'
                    : '当前 OneBot 实例使用仅协议调试模式，无法读取或保存网络配置；请使用适配器配置或直接进行协议调试。'
                )
          }
          path="/network"
        />
        <Route
          element={
            isAdmin ? (
              <AdminConfigPage />
            ) : (
              unavailable(
                '配置不可用',
                isMilky
                  ? '当前实例没有 Nyarugram /admin/v1 管理接口，无法读取或保存适配器配置。'
                  : '当前实例没有管理接口，配置不可读写；请使用显式业务地址进行协议调试。'
              )
            )
          }
          path="/config"
        />
        <Route
          element={
            isAdmin ? (
              <AdminLogsPage />
            ) : (
              unavailable(
                '管理日志不可用',
                isMilky
                  ? '当前实例没有 Nyarugram /admin/v1 管理接口，无法读取管理日志。'
                  : '当前实例没有管理接口，无法读取管理日志；请通过适配器进程日志排查。'
              )
            )
          }
          path="/logs"
        />
        <Route element={<DebugPage />} path="/debug">
          <Route
            element={isMilky ? <MilkyHttpDebug /> : <HttpDebug />}
            path="http"
          />
          <Route
            element={isMilky ? <MilkyEventDebug /> : <WSDebug />}
            path="ws"
          />
        </Route>
        <Route
          element={
            isMilky ? (
              <MilkyCallsPage />
            ) : (
              unavailable(
                '通话控制不可用',
                '当前 OneBot 实例未声明 Nyarugram 呼叫扩展。'
              )
            )
          }
          path="/calls"
        />
        <Route element={<AboutPage />} path="/about" />
      </Routes>
    </DefaultLayout>
  )
}
