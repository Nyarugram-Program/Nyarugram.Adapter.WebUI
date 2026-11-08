import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { Select, SelectItem } from '@nextui-org/select'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import useInstance from '@/hooks/use-instance'

import { setAdminSessionMarker } from '@/utils/admin-session'
import {
  clearInstanceSecrets,
  getInstanceBusinessToken,
  setInstanceBusinessToken
} from '@/utils/instance-secrets'

import NyarugramAdminManager from '@/controllers/nyarugram_admin_manager'
import {
  type AdapterInstance,
  type ManagementKind,
  type ProtocolKind,
  managementLabels,
  protocolLabels
} from '@/types/instance'

interface InstanceDraft {
  id: string
  name: string
  protocol: ProtocolKind
  managementKind: ManagementKind
  managementUrl: string
  businessUrl: string
  eventUrl: string
}

type TokenMode = 'keep' | 'replace' | 'clear'

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '')

const isHttpUrl = (value: string) => /^https?:\/\/[^\s/]+/i.test(value)
const isEventUrl = (value: string) =>
  /^(?:https?|wss?):\/\/[^\s/]+/i.test(value)

const createId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `instance-${Date.now()}-${Math.random().toString(16).slice(2)}`

const emptyDraft = (): InstanceDraft => ({
  id: createId(),
  name: '',
  protocol: 'milky',
  managementKind: 'none',
  managementUrl: '',
  businessUrl: '',
  eventUrl: ''
})

const draftFromInstance = (instance: AdapterInstance): InstanceDraft => ({
  id: instance.id,
  name: instance.name,
  protocol: instance.protocol,
  managementKind: instance.managementKind,
  managementUrl: instance.managementUrl,
  businessUrl: instance.businessUrl,
  eventUrl: instance.eventUrl
})

export default function InstancesPage() {
  const {
    instances,
    instance: activeInstance,
    selectInstance,
    upsertInstance,
    deleteInstance
  } = useInstance()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<InstanceDraft>(emptyDraft)
  const [businessToken, setBusinessToken] = useState('')
  const [tokenMode, setTokenMode] = useState<TokenMode>('replace')
  const [error, setError] = useState('')

  const updateDraft = <K extends keyof InstanceDraft>(
    field: K,
    value: InstanceDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setError('')
  }

  const validate = () => {
    if (!draft.name.trim()) return '请输入实例名称'
    if (draft.managementKind === 'napcat' && draft.protocol !== 'onebot11') {
      return 'NapCat 管理模式只适用于 OneBot V11 实例'
    }
    if (
      draft.managementKind !== 'none' &&
      !isHttpUrl(normalizeUrl(draft.managementUrl))
    ) {
      return '请输入有效的管理地址'
    }
    if (
      (draft.protocol === 'milky' || draft.managementKind !== 'napcat') &&
      !isHttpUrl(normalizeUrl(draft.businessUrl))
    ) {
      return '请输入有效的业务 HTTP 地址'
    }
    if (draft.protocol === 'milky' && !draft.eventUrl.trim()) {
      return 'Milky 实例必须显式配置事件入口'
    }
    if (draft.eventUrl.trim() && !isEventUrl(normalizeUrl(draft.eventUrl))) {
      return '事件入口必须使用 http(s):// 或 ws(s)://'
    }
    if (
      tokenMode === 'clear' &&
      !instances.some((item) => item.id === draft.id)
    ) {
      return '新实例没有可清除的已保存令牌'
    }
    return ''
  }

  const onSave = () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const now = new Date().toISOString()
    const existing = instances.find((item) => item.id === draft.id)
    const nextInstance: AdapterInstance = {
      id: draft.id,
      name: draft.name.trim(),
      protocol: draft.protocol,
      managementKind: draft.managementKind,
      managementUrl:
        draft.managementKind === 'none'
          ? ''
          : normalizeUrl(draft.managementUrl),
      businessUrl: normalizeUrl(draft.businessUrl),
      eventUrl: normalizeUrl(draft.eventUrl),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }

    upsertInstance(nextInstance)
    if (tokenMode === 'replace') {
      setInstanceBusinessToken(nextInstance.id, businessToken.trim())
    } else if (tokenMode === 'clear') {
      setInstanceBusinessToken(nextInstance.id, '')
    }
    selectInstance(nextInstance.id)
    setDraft(emptyDraft())
    setBusinessToken('')
    setTokenMode('replace')
    navigate('/')
  }

  const onDelete = async (target: AdapterInstance) => {
    if (
      !window.confirm(
        `确定删除实例“${target.name}”？此操作只删除浏览器登记信息。`
      )
    ) {
      return
    }
    if (target.managementKind === 'nyarugram-admin-v1') {
      try {
        await NyarugramAdminManager.logout(target)
      } catch {
        // 服务端会话可能已失效或不可达；本地登记仍需删除。
      }
      setAdminSessionMarker(target.id, false, target.managementUrl)
    }
    clearInstanceSecrets(target.id)
    deleteInstance(target.id)
    if (draft.id === target.id) {
      setDraft(emptyDraft())
      setBusinessToken('')
      setTokenMode('replace')
    }
  }

  const editingExisting = instances.some((item) => item.id === draft.id)
  const hasSavedToken = editingExisting && !!getInstanceBusinessToken(draft.id)

  return (
    <>
      <title>实例管理 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader className="flex justify-between">
            <div>
              <h1 className="text-xl font-bold">适配器实例</h1>
              <p className="text-sm text-default-500">
                地址必须显式登记；业务凭据仅保存在当前浏览器会话。
              </p>
            </div>
            <Button
              color="primary"
              variant="flat"
              onPress={() => {
                setDraft(emptyDraft())
                setBusinessToken('')
                setTokenMode('replace')
                setError('')
              }}
            >
              新增
            </Button>
          </CardHeader>
          <CardBody className="gap-3">
            {instances.length === 0 && (
              <div className="rounded-lg border border-dashed border-default-300 p-4 text-default-500">
                尚未登记实例。请先新增 OneBot V11 或 Milky 实例。
              </div>
            )}
            {instances.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border p-3 ${
                  activeInstance?.id === item.id
                    ? 'border-primary bg-primary-50 dark:bg-primary-950'
                    : 'border-default-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold">{item.name}</div>
                    <div className="text-xs text-default-500">
                      {protocolLabels[item.protocol]} ·{' '}
                      {managementLabels[item.managementKind]} · ID {item.id}
                    </div>
                    {item.businessUrl && (
                      <div className="text-xs break-all text-default-500">
                        业务：{item.businessUrl}
                      </div>
                    )}
                    {item.eventUrl && (
                      <div className="text-xs break-all text-default-500">
                        事件：{item.eventUrl}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => selectInstance(item.id)}
                    >
                      使用
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        setDraft(draftFromInstance(item))
                        setBusinessToken(getInstanceBusinessToken(item.id))
                        setTokenMode('keep')
                        setError('')
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      color="danger"
                      size="sm"
                      variant="light"
                      onPress={() => onDelete(item)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <div>
              <h2 className="text-xl font-bold">
                {instances.some((item) => item.id === draft.id)
                  ? '编辑实例'
                  : '新增实例'}
              </h2>
              <p className="text-sm text-default-500">
                稳定 ID 创建后不会随名称或入口变化。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="业务协议"
                selectedKeys={[draft.protocol]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0]
                  if (value === 'onebot11' || value === 'milky') {
                    updateDraft('protocol', value)
                  }
                }}
              >
                <SelectItem key="onebot11">
                  {protocolLabels.onebot11}
                </SelectItem>
                <SelectItem key="milky">{protocolLabels.milky}</SelectItem>
              </Select>
              <Select
                label="管理模式"
                selectedKeys={[draft.managementKind]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0]
                  if (
                    value === 'napcat' ||
                    value === 'nyarugram-admin-v1' ||
                    value === 'none'
                  ) {
                    updateDraft('managementKind', value)
                  }
                }}
              >
                <SelectItem key="napcat">{managementLabels.napcat}</SelectItem>
                <SelectItem key="nyarugram-admin-v1">
                  {managementLabels['nyarugram-admin-v1']}
                </SelectItem>
                <SelectItem key="none">{managementLabels.none}</SelectItem>
              </Select>
            </div>
            <Input
              label="实例名称"
              value={draft.name}
              onChange={(event) => updateDraft('name', event.target.value)}
            />
            {draft.managementKind !== 'none' && (
              <Input
                label="管理入口"
                placeholder="例如 https://adapter.example/admin/v1"
                value={draft.managementUrl}
                onChange={(event) =>
                  updateDraft('managementUrl', event.target.value)
                }
              />
            )}
            <Input
              label="业务 HTTP 入口"
              placeholder="例如 https://adapter.example"
              value={draft.businessUrl}
              onChange={(event) =>
                updateDraft('businessUrl', event.target.value)
              }
            />
            <Input
              label={
                draft.protocol === 'milky' ? '业务事件入口' : '事件入口（可选）'
              }
              placeholder={
                draft.protocol === 'milky'
                  ? 'https://adapter.example/event 或 wss://adapter.example/event'
                  : 'wss://adapter.example/event'
              }
              value={draft.eventUrl}
              onChange={(event) => updateDraft('eventUrl', event.target.value)}
            />
            <div className="grid gap-2 md:grid-cols-[10rem_1fr]">
              <Select
                label="业务令牌更新"
                isDisabled={!editingExisting}
                selectedKeys={[tokenMode]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0]
                  if (
                    value === 'keep' ||
                    value === 'replace' ||
                    value === 'clear'
                  ) {
                    setTokenMode(value)
                    if (value !== 'replace') setBusinessToken('')
                  }
                }}
              >
                <SelectItem key="keep">保持现有</SelectItem>
                <SelectItem key="replace">替换</SelectItem>
                <SelectItem key="clear">清除</SelectItem>
              </Select>
              <Input
                label="业务访问令牌"
                isDisabled={editingExisting && tokenMode !== 'replace'}
                placeholder={
                  editingExisting
                    ? tokenMode === 'keep'
                      ? hasSavedToken
                        ? '当前浏览器会话已有令牌；选择“替换”后输入新值'
                        : '当前没有保存令牌'
                      : tokenMode === 'clear'
                        ? '保存后将清除当前浏览器会话中的令牌'
                        : '输入新令牌'
                    : '仅保存到当前浏览器会话'
                }
                type="password"
                value={businessToken}
                onChange={(event) => setBusinessToken(event.target.value)}
              />
            </div>
            {error && <div className="text-sm text-danger">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button
                variant="light"
                onPress={() => {
                  if (activeInstance) navigate('/')
                  else navigate('/instances')
                }}
              >
                返回
              </Button>
              <Button color="primary" onPress={onSave}>
                保存并切换
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
