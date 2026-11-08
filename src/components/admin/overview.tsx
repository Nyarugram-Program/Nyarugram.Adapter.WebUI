import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Chip } from '@nextui-org/chip'
import { Input } from '@nextui-org/input'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'

import CodeEditor from '@/components/code_editor'

import useInstance from '@/hooks/use-instance'

import { stringifyJson } from '@/utils/json'

import NyarugramAdminManager, {
  AdminRequestError
} from '@/controllers/nyarugram_admin_manager'
import type {
  AdminAccount,
  AdminInfo,
  AdminMetrics,
  AdminSessionState
} from '@/types/admin'

import {
  AdminLoginHint,
  CapabilityList,
  ErrorLine,
  WarningLine
} from './shared'

const JsonValue = ({ value }: { value: unknown }) => (
  <pre className="whitespace-pre-wrap break-all text-xs">
    {value === undefined ? 'unknown' : stringifyJson(value, 2)}
  </pre>
)

const Metric = ({ label, value }: { label: string; value: unknown }) => (
  <div className="rounded-lg border border-default-200 p-2">
    <div className="text-xs text-default-500">{label}</div>
    <div className="break-all text-sm">
      {value === undefined || value === null ? 'unknown' : String(value)}
    </div>
  </div>
)

export default function AdminOverviewPage() {
  const { instance, generation, invalidate } = useInstance()
  const navigate = useNavigate()
  const [info, setInfo] = useState<AdminInfo>()
  const [session, setSession] = useState<AdminSessionState | null>()
  const [account, setAccount] = useState<AdminAccount>()
  const [metrics, setMetrics] = useState<AdminMetrics>()
  const [health, setHealth] = useState<Record<string, unknown>>()
  const [loadError, setLoadError] = useState('')
  const [unauthorized, setUnauthorized] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')

  useEffect(() => {
    if (!instance || instance.managementKind !== 'nyarugram-admin-v1') return
    const controller = new AbortController()
    const signal = controller.signal
    let disposed = false

    setLoadError('')
    setUnauthorized(false)

    const handleError = (error: unknown) => {
      if (disposed) return
      if (error instanceof AdminRequestError && error.status === 401) {
        setUnauthorized(true)
        return
      }
      setLoadError((current) =>
        current
          ? `${current}；${(error as Error).message}`
          : (error as Error).message
      )
    }

    NyarugramAdminManager.getInfo(instance, signal)
      .then((value) => !disposed && setInfo(value))
      .catch(handleError)
    NyarugramAdminManager.getSession(instance, signal)
      .then((value) => {
        if (disposed) return
        setSession(value)
        if (!value) setUnauthorized(true)
      })
      .catch(handleError)
    NyarugramAdminManager.getAccount(instance, signal)
      .then((value) => !disposed && setAccount(value))
      .catch(handleError)
    NyarugramAdminManager.getMetrics(instance, signal)
      .then((value) => !disposed && setMetrics(value))
      .catch(handleError)
    NyarugramAdminManager.getHealth(instance, signal)
      .then((value) => !disposed && setHealth(value))
      .catch(handleError)

    return () => {
      disposed = true
      controller.abort()
    }
  }, [instance, generation, refreshNonce])

  if (!instance) {
    return (
      <div className="p-4">
        <Card>
          <CardBody>尚未选择适配器实例。</CardBody>
        </Card>
      </div>
    )
  }

  if (instance.managementKind !== 'nyarugram-admin-v1') {
    return (
      <div className="p-4">
        <Card>
          <CardBody>当前实例未配置 Nyarugram /admin/v1 管理接口。</CardBody>
        </Card>
      </div>
    )
  }

  const onAccountLogin = async () => {
    if (!username.trim() || !password) {
      setAccountError('请输入后端账号和密码')
      return
    }
    setAccountBusy(true)
    setAccountError('')
    try {
      const result = await NyarugramAdminManager.loginAccount(
        instance,
        username.trim(),
        password,
        totp.trim()
      )
      setAccount(result)
      setPassword('')
      setTotp('')
      toast.success('机器人账号登录成功')
      // 账号变化必须让事件作用域、连接和迟到请求一起失效。
      invalidate()
    } catch (error) {
      setAccountError((error as Error).message)
      setPassword('')
      setTotp('')
    } finally {
      setAccountBusy(false)
    }
  }

  const onAccountLogout = async () => {
    if (
      !window.confirm(
        '退出当前适配器绑定的后端账号？事件连接和通话会随会话失效。'
      )
    ) {
      return
    }
    setAccountBusy(true)
    setAccountError('')
    try {
      await NyarugramAdminManager.logoutAccount(instance)
      setAccount(undefined)
      toast.success('机器人账号已退出')
      invalidate()
    } catch (error) {
      setAccountError((error as Error).message)
    } finally {
      setAccountBusy(false)
    }
  }

  const accountLoggedIn =
    account?.state === 'active' ||
    account?.state === 'logged_in' ||
    (!account?.state && !!account?.account_id)

  return (
    <>
      <title>管理概览 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        {unauthorized && (
          <div className="xl:col-span-2">
            <AdminLoginHint />
          </div>
        )}
        <ErrorLine message={loadError} />
        <WarningLine
          message={
            session
              ? `管理会话有效期至 ${session.expires_at ?? 'unknown'}`
              : undefined
          }
        />

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">实例与能力</h1>
              <p className="text-sm text-default-500">
                管理信息、协议版本和能力声明均来自当前实例的 /admin/v1/info。
              </p>
            </div>
            <Button
              size="sm"
              variant="flat"
              onPress={() => setRefreshNonce((value) => value + 1)}
            >
              刷新
            </Button>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Chip size="sm" variant="flat">
                {instance.name}
              </Chip>
              <Chip size="sm" variant="flat">
                {instance.protocol}
              </Chip>
              <Chip size="sm" variant="flat">
                {instance.managementKind}
              </Chip>
            </div>
            {info ? (
              <>
                <div className="grid gap-2 md:grid-cols-2">
                  <Metric label="管理 API" value={info.api_version} />
                  <Metric label="适配器" value={info.adapter_kind} />
                  <Metric label="适配器版本" value={info.adapter_version} />
                  <Metric label="协议版本" value={info.protocol_version} />
                  <Metric label="实例 ID" value={info.instance_id} />
                </div>
                <div className="grid gap-2">
                  <div className="text-default-500">能力</div>
                  <CapabilityList capabilities={info.capabilities} />
                </div>
                {info.endpoints && (
                  <details>
                    <summary className="cursor-pointer">入口</summary>
                    <JsonValue value={info.endpoints} />
                  </details>
                )}
              </>
            ) : (
              <div className="text-default-400">正在读取管理信息…</div>
            )}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <div>
              <h1 className="text-xl font-bold">机器人账号</h1>
              <p className="text-sm text-default-500">
                与 Web
                管理会话分离。密码和验证器只用于本次请求，成功后立即清除。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            {account ? (
              <div className="grid gap-2 rounded-lg border border-default-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    color={accountLoggedIn ? 'success' : 'default'}
                    size="sm"
                    variant="flat"
                  >
                    {account.state ?? (accountLoggedIn ? 'active' : 'unknown')}
                  </Chip>
                  <span>{account.display_name ?? 'unknown'}</span>
                </div>
                <Metric label="用户名" value={account.username} />
                <Metric label="gram_id" value={account.gram_id} />
                <Metric label="数字 ID" value={account.numeric_user_id} />
                <Metric label="会话代际" value={account.generation} />
                {account.reason && <WarningLine message={account.reason} />}
                {accountLoggedIn && (
                  <Button
                    color="danger"
                    isLoading={accountBusy}
                    variant="flat"
                    onPress={onAccountLogout}
                  >
                    退出机器人账号
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-default-400">尚未读取到账号状态。</div>
            )}

            {!accountLoggedIn && !unauthorized && (
              <div className="grid gap-2 rounded-lg border border-default-200 p-3">
                <div className="font-medium">登录后端账号</div>
                <Input
                  isDisabled={accountBusy}
                  label="用户名"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <Input
                  isDisabled={accountBusy}
                  label="密码"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Input
                  isDisabled={accountBusy}
                  label="验证器代码（如已启用）"
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                />
                <Button
                  color="primary"
                  isLoading={accountBusy}
                  onPress={onAccountLogin}
                >
                  登录账号
                </Button>
              </div>
            )}
            <ErrorLine message={accountError} />
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <h2 className="text-xl font-bold">运行指标</h2>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            {metrics ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Metric label="账号在线" value={metrics.account?.logged_in} />
                <Metric
                  label="账号显示名"
                  value={metrics.account?.display_name}
                />
                <Metric label="会话代际" value={metrics.account?.generation} />
                <Metric label="存储状态" value={metrics.storage?.state} />
                <Metric label="Outbox 待投递" value={metrics.outbox?.pending} />
                <Metric label="Outbox 过期" value={metrics.outbox?.expired} />
                <Metric
                  label="事件订阅者"
                  value={metrics.events?.subscribers}
                />
                <Metric label="媒体引擎" value={metrics.media?.engine} />
                <Metric label="媒体可用" value={metrics.media?.available} />
                <Metric label="真实音频" value={metrics.media?.audio} />
                <Metric
                  label="已应用配置"
                  value={metrics.config?.applied_version}
                />
                <Metric
                  label="已保存配置"
                  value={metrics.config?.saved_version}
                />
              </div>
            ) : (
              <div className="text-default-400">正在读取指标…</div>
            )}
            {metrics?.media?.reason && (
              <WarningLine message={metrics.media.reason} />
            )}
            {metrics && (
              <details>
                <summary className="cursor-pointer">原始指标</summary>
                <JsonValue value={metrics} />
              </details>
            )}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <h2 className="text-xl font-bold">管理与业务入口</h2>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            <Metric label="管理入口" value={instance.managementUrl} />
            <Metric
              label="业务 HTTP"
              value={instance.businessUrl || '未配置'}
            />
            <Metric label="事件入口" value={instance.eventUrl || '未配置'} />
            <div className="flex flex-wrap gap-2">
              <Button variant="flat" onPress={() => navigate('/debug/http')}>
                协议 HTTP 调试
              </Button>
              <Button variant="flat" onPress={() => navigate('/debug/ws')}>
                事件调试
              </Button>
              {instance.protocol === 'milky' && (
                <Button variant="flat" onPress={() => navigate('/calls')}>
                  通话控制
                </Button>
              )}
            </div>
            {health && (
              <details>
                <summary className="cursor-pointer">管理健康数据</summary>
                <CodeEditor
                  height="220px"
                  language="json"
                  options={{ readOnly: true }}
                  value={stringifyJson(health, 2)}
                />
              </details>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
