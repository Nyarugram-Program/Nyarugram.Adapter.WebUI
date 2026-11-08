import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { useEffect, useRef, useState } from 'react'
import { IoCall, IoCallOutline, IoClose } from 'react-icons/io5'

import CodeEditor from '@/components/code_editor'

import useInstance from '@/hooks/use-instance'

import {
  getInstanceBusinessToken,
  setInstanceBusinessToken
} from '@/utils/instance-secrets'
import { stringifyJson } from '@/utils/json'

import MilkyManager from '@/controllers/milky_manager'
import type { MilkyCapabilities } from '@/types/milky'

const toProtocolInt = (value: string) => {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) throw new Error('数字 ID 必须是十进制整数')
  const numberValue = Number(trimmed)
  if (Number.isSafeInteger(numberValue)) return numberValue
  return BigInt(trimmed)
}

export default function MilkyCallsPage() {
  const { instance, generation } = useInstance()
  const [token, setToken] = useState('')
  const [capabilities, setCapabilities] = useState<MilkyCapabilities>()
  const [error, setError] = useState('')
  const [userId, setUserId] = useState('')
  const [callId, setCallId] = useState('')
  const [requestId, setRequestId] = useState('')
  const [responseText, setResponseText] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const requestAbortRef = useRef<AbortController | undefined>(undefined)
  const instanceIdRef = useRef(instance?.id)
  const generationRef = useRef(generation)

  useEffect(() => {
    instanceIdRef.current = instance?.id
    generationRef.current = generation
    requestAbortRef.current?.abort()
    setResponseText('')
    setError('')
  }, [instance?.id, generation])

  useEffect(() => {
    if (!instance) return
    const savedToken = getInstanceBusinessToken(instance.id)
    setToken(savedToken)
    setCapabilities(undefined)
    const controller = new AbortController()
    if (savedToken) {
      setError('')
      MilkyManager.getCapabilities(instance, savedToken, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setCapabilities(value)
        })
        .catch((requestError: Error) => {
          if (!controller.signal.aborted) setError(requestError.message)
        })
    }
    return () => controller.abort()
  }, [instance, generation])

  useEffect(
    () => () => {
      requestAbortRef.current?.abort()
    },
    []
  )

  if (!instance || instance.protocol !== 'milky') {
    return (
      <div className="p-4">
        <Card>
          <CardBody>当前实例不是 Milky。</CardBody>
        </Card>
      </div>
    )
  }

  const callsControl = capabilities?.calls?.control ?? false
  const voice = capabilities?.calls?.voice ?? false
  const reason = capabilities?.calls?.reason

  const callAction = async (
    action: string,
    params: Record<string, unknown>
  ) => {
    if (!callsControl) return
    if (!token.trim()) {
      setError('请输入业务访问令牌')
      return
    }
    setIsFetching(true)
    setError('')
    setInstanceBusinessToken(instance.id, token.trim())
    const requestInstanceId = instance.id
    const requestGeneration = generation
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    try {
      const response = await MilkyManager.call(
        instance,
        token.trim(),
        action,
        params,
        controller.signal
      )
      if (
        controller.signal.aborted ||
        instanceIdRef.current !== requestInstanceId ||
        generationRef.current !== requestGeneration
      ) {
        return
      }
      setResponseText(stringifyJson(response, 2))
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError((requestError as Error).message)
      }
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = undefined
        setIsFetching(false)
      }
    }
  }

  return (
    <>
      <title>通话控制 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <div>
              <h1 className="text-xl font-bold">通话控制</h1>
              <p className="text-sm text-default-500">
                控制操作仅在适配器 capability 声明 support 时可用。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3">
            <Input
              label="业务访问令牌"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {!capabilities && !error && <div>正在查询能力…</div>}
            {capabilities && (
              <div className="grid gap-2 rounded-lg border border-default-200 p-3 text-sm md:grid-cols-2">
                <div>控制：{String(callsControl)}</div>
                <div>真实语音：{String(voice)}</div>
                <div>视频：{String(capabilities.calls?.video ?? false)}</div>
                <div>
                  自动接听：{String(capabilities.calls?.auto_answer ?? false)}
                </div>
              </div>
            )}
            {(reason || capabilities?.limitations?.length) && (
              <div className="rounded-lg border border-warning bg-warning-50 p-3 text-sm text-warning-700 dark:text-warning-200">
                {reason ?? capabilities?.limitations?.join('；')}
              </div>
            )}
            {!callsControl && capabilities && (
              <div className="rounded-lg border border-danger bg-danger-50 p-3 text-sm text-danger">
                当前实例未启用呼叫控制；不会显示伪造的拨号结果。
              </div>
            )}
            {error && <div className="text-sm text-danger">{error}</div>}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <h2 className="text-xl font-bold">信令操作</h2>
          </CardHeader>
          <CardBody className="grid gap-3">
            <Input
              isDisabled={!callsControl}
              label="对端数字 ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <Input
              isDisabled={!callsControl}
              label="呼叫 ID"
              value={callId}
              onChange={(event) => setCallId(event.target.value)}
            />
            <Input
              isDisabled={!callsControl}
              label="请求 ID"
              placeholder="留空时由界面生成"
              value={requestId}
              onChange={(event) => setRequestId(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                color="primary"
                isDisabled={!callsControl || isFetching}
                startContent={<IoCall />}
                onPress={() => {
                  try {
                    void callAction('nyarugram_start_call', {
                      user_id: toProtocolInt(userId),
                      video: false,
                      request_id:
                        requestId.trim() || `webui-${crypto.randomUUID()}`
                    })
                  } catch (requestError) {
                    setError((requestError as Error).message)
                  }
                }}
              >
                发起
              </Button>
              <Button
                color="success"
                isDisabled={!callsControl || isFetching}
                startContent={<IoCallOutline />}
                onPress={() =>
                  void callAction('nyarugram_accept_call', {
                    call_id: callId.trim(),
                    ...(requestId.trim()
                      ? { request_id: requestId.trim() }
                      : {})
                  })
                }
              >
                接听
              </Button>
              <Button
                color="danger"
                isDisabled={!callsControl || isFetching}
                startContent={<IoClose />}
                onPress={() =>
                  void callAction('nyarugram_end_call', {
                    call_id: callId.trim(),
                    reason: 'hangup',
                    ...(requestId.trim()
                      ? { request_id: requestId.trim() }
                      : {})
                  })
                }
              >
                挂断
              </Button>
              <Button
                variant="flat"
                isDisabled={!callsControl || isFetching}
                onPress={() =>
                  void callAction('nyarugram_get_call', {
                    call_id: callId.trim()
                  })
                }
              >
                查询
              </Button>
            </div>
            {voice ? (
              <div className="text-sm text-default-500">
                实例声明了真实语音能力；浏览器媒体接入仍需按媒体契约单独验证。
              </div>
            ) : (
              <div className="text-sm text-warning">
                当前实例未声明真实语音媒体，不能执行浏览器双向语音。
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm xl:col-span-2">
          <CardHeader>
            <h2 className="text-xl font-bold">响应</h2>
          </CardHeader>
          <CardBody>
            {responseText ? (
              <CodeEditor
                height="320px"
                language="json"
                options={{ readOnly: true }}
                value={responseText}
              />
            ) : (
              <div className="text-default-400">暂无响应</div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
