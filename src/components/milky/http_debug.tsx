import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { Select, SelectItem } from '@nextui-org/select'
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { IoSend } from 'react-icons/io5'

import { milkyApis } from '@/const/milky_api'

import CodeEditor from '@/components/code_editor'

import useInstance from '@/hooks/use-instance'

import {
  getInstanceBusinessToken,
  setInstanceBusinessToken
} from '@/utils/instance-secrets'
import { parseJson, stringifyJson } from '@/utils/json'

import MilkyManager from '@/controllers/milky_manager'
import type { MilkyCapabilities } from '@/types/milky'

const findApi = (action: string) =>
  milkyApis.find((item) => item.action === action) ?? milkyApis[0]

export default function MilkyHttpDebug() {
  const { instance } = useInstance()
  const [selectedAction, setSelectedAction] = useState('get_impl_info')
  const [token, setToken] = useState('')
  const [requestBody, setRequestBody] = useState(
    stringifyJson(findApi('get_impl_info').requestExample, 2)
  )
  const [responseText, setResponseText] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const [capabilities, setCapabilities] = useState<MilkyCapabilities>()
  const [capabilityError, setCapabilityError] = useState('')
  const abortRef = useRef<AbortController | undefined>(undefined)

  const selectedApi = useMemo(() => findApi(selectedAction), [selectedAction])
  const requestUrl = instance?.businessUrl
    ? `${instance.businessUrl.replace(/\/+$/, '')}/api/${selectedAction}`
    : ''
  const isActionUnavailable =
    !!capabilities?.apis && !capabilities.apis.includes(selectedAction)

  useEffect(() => {
    if (!instance) return
    const savedToken = getInstanceBusinessToken(instance.id)
    setToken(savedToken)
    const controller = new AbortController()
    if (!savedToken) {
      setCapabilityError('尚未输入业务访问令牌，无法查询当前实例能力。')
      return
    }
    setCapabilityError('')
    MilkyManager.getCapabilities(instance, savedToken, controller.signal)
      .then(setCapabilities)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setCapabilityError(error.message)
      })
    return () => controller.abort()
  }, [instance])

  useEffect(() => {
    setRequestBody(stringifyJson(selectedApi.requestExample, 2))
    setResponseText('')
  }, [selectedApi])

  useEffect(() => () => abortRef.current?.abort(), [])

  const onSend = async () => {
    if (!instance) return
    if (!token.trim()) {
      toast.error('请输入业务访问令牌')
      return
    }
    if (isActionUnavailable) {
      toast.error('当前实例未声明支持该动作')
      return
    }

    let parsedBody: unknown
    try {
      parsedBody = parseJson(requestBody)
    } catch (error) {
      toast.error((error as Error).message)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsFetching(true)
    setInstanceBusinessToken(instance.id, token.trim())
    try {
      const response = await MilkyManager.call(
        instance,
        token.trim(),
        selectedAction,
        parsedBody,
        controller.signal
      )
      if (controller.signal.aborted) return
      setResponseText(stringifyJson(response, 2))
      if (response.status === 'ok') {
        toast.success('请求已完成，请查看响应')
      } else {
        toast.error(response.message ?? `业务调用失败（${response.retcode}）`)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setResponseText('')
        toast.error((error as Error).message)
      }
    } finally {
      if (abortRef.current === controller) {
        setIsFetching(false)
        abortRef.current = undefined
      }
    }
  }

  if (!instance || instance.protocol !== 'milky') {
    return (
      <div className="p-4">
        <Card>
          <CardBody>当前实例不是 Milky。</CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[20rem_1fr]">
      <Card className="h-fit bg-opacity-60 backdrop-blur-sm">
        <CardHeader>
          <h1 className="text-lg font-bold">Milky 动作</h1>
        </CardHeader>
        <CardBody className="gap-3">
          <Select
            label="动作"
            selectedKeys={[selectedAction]}
            onSelectionChange={(keys) => {
              const action = Array.from(keys)[0]
              if (typeof action === 'string') setSelectedAction(action)
            }}
          >
            {milkyApis.map((item) => (
              <SelectItem key={item.action}>{item.action}</SelectItem>
            ))}
          </Select>
          <div className="text-sm text-default-600 dark:text-default-300">
            {selectedApi.description}
            {selectedApi.requiresAccount && (
              <div className="text-xs text-default-500">需要账号会话</div>
            )}
          </div>
          {capabilityError && (
            <div className="text-xs text-warning">{capabilityError}</div>
          )}
          {capabilities && isActionUnavailable && (
            <div className="text-xs text-danger">
              当前实例能力集合未包含此动作。
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4">
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardBody className="gap-3">
            <Input
              isReadOnly
              label="请求地址"
              value={requestUrl || '实例未配置业务地址'}
            />
            <Input
              label="业务访问令牌"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader className="justify-between">
            <h2 className="text-lg font-bold">请求体</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="flat"
                onPress={() =>
                  setRequestBody(stringifyJson(selectedApi.requestExample, 2))
                }
              >
                填充示例
              </Button>
              <Button
                aria-label="发送请求"
                color="danger"
                isIconOnly
                isDisabled={isFetching || isActionUnavailable}
                size="sm"
                onPress={onSend}
              >
                <IoSend />
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            <CodeEditor
              height="320px"
              language="json"
              value={requestBody}
              onChange={(value) => setRequestBody(value ?? '')}
            />
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <h2 className="text-lg font-bold">响应</h2>
          </CardHeader>
          <CardBody>
            {responseText ? (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all text-sm">
                {responseText}
              </pre>
            ) : (
              <div className="text-default-400">暂无响应</div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
