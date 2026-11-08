import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { Select, SelectItem } from '@nextui-org/select'
import { Switch } from '@nextui-org/switch'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import useInstance from '@/hooks/use-instance'

import { stringifyJson } from '@/utils/json'

import NyarugramAdminManager, {
  AdminRequestError
} from '@/controllers/nyarugram_admin_manager'
import type {
  AdminConfig,
  AdminConfigField,
  AdminConfigSaveRequest,
  AdminConfigSchema,
  AdminConfigStatus,
  AdminSecretValue
} from '@/types/admin'

import { AdminLoginHint, ErrorLine, WarningLine } from './shared'

type ConfigValues = Record<string, unknown>

const getAtPath = (source: unknown, path: string): unknown => {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

const setAtPath = (
  source: ConfigValues,
  path: string,
  value: unknown
): ConfigValues => {
  const segments = path.split('.')
  const root: ConfigValues = { ...source }
  let cursor: Record<string, unknown> = root
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value
      return
    }
    const existing = cursor[segment]
    const next =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cursor[segment] = next
    cursor = next
  })
  return root
}

const normalizeValue = (field: AdminConfigField, value: unknown) => {
  if (value === undefined) return undefined
  if (field.type === 'number') {
    if (value === '') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}

export default function AdminConfigPage() {
  const { instance, generation } = useInstance()
  const [schema, setSchema] = useState<AdminConfigSchema>()
  const [config, setConfig] = useState<AdminConfig>()
  const [status, setStatus] = useState<AdminConfigStatus>()
  const [values, setValues] = useState<ConfigValues>({})
  const [secretOps, setSecretOps] = useState<Record<string, AdminSecretValue>>(
    {}
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [unauthorized, setUnauthorized] = useState(false)
  const [busy, setBusy] = useState<'validate' | 'save' | ''>('')
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    if (!instance || instance.managementKind !== 'nyarugram-admin-v1') return
    const controller = new AbortController()
    const signal = controller.signal
    let disposed = false

    const load = async () => {
      setLoadError('')
      setUnauthorized(false)
      try {
        const [schemaData, configData, statusData] = await Promise.all([
          NyarugramAdminManager.getConfigSchema(instance, signal),
          NyarugramAdminManager.getConfig(instance, signal),
          NyarugramAdminManager.getConfigStatus(instance, signal)
        ])
        if (disposed) return
        setSchema(schemaData)
        setConfig(configData)
        setStatus(statusData)

        let nextValues: ConfigValues = {}
        for (const field of schemaData.fields ?? []) {
          if (field.type === 'secret') continue
          const value = getAtPath(configData.values, field.path)
          if (value !== undefined) {
            nextValues = setAtPath(nextValues, field.path, value)
          }
        }
        setValues(nextValues)

        const nextSecretOps: Record<string, AdminSecretValue> = {}
        for (const field of schemaData.fields ?? []) {
          if (field.type === 'secret') {
            nextSecretOps[field.path] = { state: 'keep' }
          }
        }
        setSecretOps(nextSecretOps)
        setFieldErrors({})
      } catch (error) {
        if (disposed) return
        if (error instanceof AdminRequestError && error.status === 401) {
          setUnauthorized(true)
          return
        }
        setLoadError((error as Error).message)
      }
    }

    load()
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

  const buildPayload = (): AdminConfigSaveRequest | undefined => {
    if (!schema) return undefined
    const nextValues: ConfigValues = {}
    for (const field of schema.fields ?? []) {
      if (field.type === 'secret') continue
      const value = normalizeValue(field, getAtPath(values, field.path))
      if (value !== undefined) {
        const merged = setAtPath(nextValues, field.path, value)
        Object.keys(nextValues).forEach((key) => delete nextValues[key])
        Object.assign(nextValues, merged)
      }
    }

    const secrets: Record<string, AdminSecretValue> = {}
    const errors: Record<string, string> = {}
    for (const field of schema.fields ?? []) {
      if (field.type !== 'secret') continue
      const operation = secretOps[field.path] ?? { state: 'keep' }
      if (operation.state === 'replace' && !operation.value) {
        errors[field.path] = '选择“替换”时必须输入新值'
      }
      secrets[field.path] = operation
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return undefined

    return { values: nextValues, secrets }
  }

  const onValidate = async () => {
    const payload = buildPayload()
    if (!payload) return
    setBusy('validate')
    setMessage('')
    try {
      const result = await NyarugramAdminManager.validateConfig(
        instance,
        payload
      )
      setFieldErrors(result.errors ?? {})
      if (result.valid) {
        toast.success('配置校验通过')
        setMessage('校验通过；保存后仍需按状态提示重启或应用。')
      } else {
        setMessage('配置校验未通过，请检查字段错误。')
      }
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        setUnauthorized(true)
      } else {
        setMessage((error as Error).message)
      }
    } finally {
      setBusy('')
    }
  }

  const onSave = async () => {
    if (!config) return
    const payload = buildPayload()
    if (!payload) return
    setBusy('save')
    setMessage('')
    try {
      const saved = await NyarugramAdminManager.saveConfig(
        instance,
        payload,
        config.version
      )
      setConfig(saved)
      setMessage('配置已保存。请查看生效状态并根据需要重启适配器。')
      toast.success('配置已保存')
      setRefreshNonce((value) => value + 1)
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        setUnauthorized(true)
      } else if (
        error instanceof AdminRequestError &&
        (error.status === 409 || error.status === 412)
      ) {
        setMessage('配置版本已被其他管理员修改，请刷新后重试。')
        setRefreshNonce((value) => value + 1)
      } else if (error instanceof AdminRequestError && error.fields) {
        setFieldErrors(error.fields)
        setMessage(error.message)
      } else {
        setMessage((error as Error).message)
      }
    } finally {
      setBusy('')
    }
  }

  const fields = schema?.fields ?? []
  const hasSchema = fields.length > 0

  return (
    <>
      <title>适配器配置 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_20rem]">
        {unauthorized && (
          <div className="xl:col-span-2">
            <AdminLoginHint />
          </div>
        )}
        <ErrorLine message={loadError} />
        <WarningLine message={message} />

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">配置</h1>
              <p className="text-sm text-default-500">
                秘密字段默认保持原值；只有显式选择“替换”并输入新值才会更新。
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="flat"
                onPress={() => setRefreshNonce((value) => value + 1)}
              >
                刷新
              </Button>
              <Button
                isDisabled={!hasSchema || busy !== ''}
                isLoading={busy === 'validate'}
                size="sm"
                variant="flat"
                onPress={onValidate}
              >
                校验
              </Button>
              <Button
                color="primary"
                isDisabled={!hasSchema || busy !== ''}
                isLoading={busy === 'save'}
                size="sm"
                onPress={onSave}
              >
                保存
              </Button>
            </div>
          </CardHeader>
          <CardBody className="grid gap-4">
            {!hasSchema && !loadError && !unauthorized && (
              <div className="text-default-400">正在读取配置定义…</div>
            )}
            {!hasSchema && unauthorized && (
              <div className="text-warning">
                建立管理会话后才能读取和保存配置。
              </div>
            )}
            {!hasSchema && loadError && (
              <div className="text-warning">
                配置定义加载失败；不会伪造保存成功。{loadError}
              </div>
            )}
            {fields.map((field) => {
              const value = getAtPath(values, field.path)
              const secretState = secretOps[field.path]
              const secretSet = config?.secrets?.[field.path]?.is_set
              return (
                <div key={field.path} className="grid gap-1">
                  {field.type === 'boolean' ? (
                    <Switch
                      isSelected={value === true}
                      onValueChange={(selected) =>
                        setValues((current) =>
                          setAtPath(current, field.path, selected)
                        )
                      }
                    >
                      {field.label}
                    </Switch>
                  ) : field.type === 'select' ? (
                    <Select
                      label={field.label}
                      selectedKeys={value === undefined ? [] : [String(value)]}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0]
                        if (typeof selected !== 'string') return
                        const option = field.options?.find(
                          (item) => String(item.value) === selected
                        )
                        setValues((current) =>
                          setAtPath(
                            current,
                            field.path,
                            option ? option.value : selected
                          )
                        )
                      }}
                    >
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={String(option.value)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : field.type === 'secret' ? (
                    <div className="grid gap-2 rounded-lg border border-default-200 p-3">
                      <div className="text-sm font-medium">
                        {field.label}
                        <span className="ml-2 text-xs text-default-500">
                          {secretSet ? '当前已设置' : '当前未设置'}
                        </span>
                      </div>
                      <Select
                        label="更新方式"
                        selectedKeys={[secretState?.state ?? 'keep']}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys)[0]
                          if (
                            selected === 'keep' ||
                            selected === 'replace' ||
                            selected === 'clear'
                          ) {
                            setSecretOps((current) => ({
                              ...current,
                              [field.path]: {
                                state: selected,
                                value:
                                  selected === 'replace'
                                    ? current[field.path]?.value
                                    : undefined
                              }
                            }))
                          }
                        }}
                      >
                        <SelectItem key="keep">保持原有</SelectItem>
                        <SelectItem key="replace">替换</SelectItem>
                        <SelectItem key="clear">清除</SelectItem>
                      </Select>
                      {secretState?.state === 'replace' && (
                        <Input
                          label="新值"
                          type="password"
                          value={secretState.value ?? ''}
                          onChange={(event) =>
                            setSecretOps((current) => ({
                              ...current,
                              [field.path]: {
                                state: 'replace',
                                value: event.target.value
                              }
                            }))
                          }
                        />
                      )}
                    </div>
                  ) : (
                    <Input
                      isReadOnly={field.type === 'readonly'}
                      label={field.label}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={
                        value === undefined || value === null
                          ? ''
                          : String(value)
                      }
                      onChange={(event) =>
                        setValues((current) =>
                          setAtPath(current, field.path, event.target.value)
                        )
                      }
                    />
                  )}
                  {field.description && (
                    <div className="text-xs text-default-500">
                      {field.description}
                    </div>
                  )}
                  {field.requires_restart && (
                    <div className="text-xs text-warning">
                      修改后需要重启适配器生效。
                    </div>
                  )}
                  {fieldErrors[field.path] && (
                    <div className="text-xs text-danger">
                      {fieldErrors[field.path]}
                    </div>
                  )}
                </div>
              )
            })}
          </CardBody>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="bg-opacity-60 backdrop-blur-sm">
            <CardHeader>
              <h2 className="text-lg font-bold">版本与生效状态</h2>
            </CardHeader>
            <CardBody className="grid gap-2 text-sm">
              <div>读取版本：{config?.version ?? 'unknown'}</div>
              <div>已保存版本：{status?.saved_version ?? 'unknown'}</div>
              <div>进程已应用：{status?.applied_version ?? 'unknown'}</div>
              <div className="flex flex-wrap gap-2">
                <span className="text-default-500">状态：</span>
                <span
                  className={
                    status?.state === 'failed'
                      ? 'text-danger'
                      : status?.state === 'requires_restart'
                        ? 'text-warning'
                        : 'text-success'
                  }
                >
                  {status?.state ?? 'unknown'}
                </span>
              </div>
              {status?.message && <WarningLine message={status.message} />}
              {config?.requires_restart && (
                <WarningLine message="当前保存版本与进程启动版本不同，需要重启适配器。" />
              )}
            </CardBody>
          </Card>

          <Card className="bg-opacity-60 backdrop-blur-sm">
            <CardHeader>
              <h2 className="text-lg font-bold">脱敏原始配置</h2>
            </CardHeader>
            <CardBody>
              {config ? (
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all text-xs">
                  {stringifyJson(config, 2)}
                </pre>
              ) : (
                <div className="text-default-400">尚未读取配置。</div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
