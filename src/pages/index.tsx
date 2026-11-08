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

import DashboardIndexPage from './dashboard'
import AboutPage from './dashboard/about'
import ConfigPage from './dashboard/config'
import DebugPage from './dashboard/debug'
import HttpDebug from './dashboard/debug/http'
import WSDebug from './dashboard/debug/websocket'
import LogsPage from './dashboard/logs'
import NetworkPage from './dashboard/network'

export default function IndexPage() {
  const { instance, generation } = useInstance()
  const isMilky = instance?.protocol === 'milky'
  const isAdmin = instance?.managementKind === 'nyarugram-admin-v1'
  const isNapcat =
    instance?.managementKind === 'napcat' && instance?.protocol === 'onebot11'

  const overview = isAdmin ? (
    <AdminOverviewPage />
  ) : isMilky ? (
    <MilkyOverviewPage />
  ) : isNapcat ? (
    <DashboardIndexPage />
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
            isNapcat ? (
              <NetworkPage />
            ) : (
              <CapabilityUnavailable
                reason={
                  isMilky
                    ? 'Milky 的监听与事件配置由适配器管理，不复用 NapCat 网络配置模型。'
                    : '当前 OneBot 实例没有 NapCat 管理接口；请使用适配器配置或直接进行协议调试。'
                }
                title="网络配置不可用"
              />
            )
          }
          path="/network"
        />
        <Route
          element={
            isAdmin ? (
              <AdminConfigPage />
            ) : isNapcat ? (
              <ConfigPage />
            ) : (
              <CapabilityUnavailable
                reason={
                  isMilky
                    ? '当前实例没有 Nyarugram /admin/v1 管理接口，无法读取或保存适配器配置。'
                    : '当前实例没有管理接口，配置不可读写；请使用显式业务地址进行协议调试。'
                }
                title="配置不可用"
              />
            )
          }
          path="/config"
        />
        <Route
          element={
            isAdmin ? (
              <AdminLogsPage />
            ) : isNapcat ? (
              <LogsPage />
            ) : (
              <CapabilityUnavailable
                reason={
                  isMilky
                    ? '当前实例没有 Nyarugram /admin/v1 管理接口，无法读取管理日志。'
                    : '当前实例没有管理接口，无法读取管理日志；请通过适配器进程日志排查。'
                }
                title="管理日志不可用"
              />
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
              <CapabilityUnavailable
                reason="当前 OneBot 实例未声明 Nyarugram 呼叫扩展。"
                title="通话控制不可用"
              />
            )
          }
          path="/calls"
        />
        <Route element={<AboutPage />} path="/about" />
      </Routes>
    </DefaultLayout>
  )
}
