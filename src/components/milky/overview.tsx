import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { useEffect, useState } from 'react'

import useInstance from '@/hooks/use-instance'

import { getInstanceBusinessToken } from '@/utils/instance-secrets'
import { stringifyJson } from '@/utils/json'

import MilkyManager from '@/controllers/milky_manager'
import type { MilkyCapabilities, MilkyHealth } from '@/types/milky'

const Value = ({ value }: { value: unknown }) => (
  <pre className="whitespace-pre-wrap break-all text-sm">
    {value === undefined ? 'unknown' : stringifyJson(value)}
  </pre>
)

export default function MilkyOverviewPage() {
  const { instance } = useInstance()
  const [health, setHealth] = useState<MilkyHealth>()
  const [capabilities, setCapabilities] = useState<MilkyCapabilities>()
  const [healthError, setHealthError] = useState('')
  const [capabilitiesError, setCapabilitiesError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!instance || instance.protocol !== 'milky') return
    const controller = new AbortController()
    const token = getInstanceBusinessToken(instance.id)

    const load = async () => {
      setIsLoading(true)
      setHealth(undefined)
      setCapabilities(undefined)
      setHealthError('')
      setCapabilitiesError('')
      try {
        setHealth(await MilkyManager.getHealth(instance, controller.signal))
      } catch (error) {
        if (!controller.signal.aborted) {
          setHealthError((error as Error).message)
        }
      }
      try {
        setCapabilities(
          await MilkyManager.getCapabilities(instance, token, controller.signal)
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          setCapabilitiesError((error as Error).message)
        }
      }
      if (!controller.signal.aborted) setIsLoading(false)
    }

    load()
    return () => controller.abort()
  }, [instance])

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
    <>
      <title>实例概览 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <div>
              <h1 className="text-xl font-bold">运行状态</h1>
              <p className="text-sm text-default-500">
                /health 仅反映存储与本地账号绑定，不证明 Nyarugram 后端在线。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            {isLoading && <div>正在查询…</div>}
            {healthError && <div className="text-danger">{healthError}</div>}
            {health && (
              <>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-default-500">适配器状态</div>
                    <Value value={health.status} />
                  </div>
                  <div>
                    <div className="text-default-500">数据库</div>
                    <Value value={health.storage ?? 'unknown'} />
                  </div>
                  <div>
                    <div className="text-default-500">账号绑定</div>
                    <Value value={health.logged_in ?? 'unknown'} />
                  </div>
                  <div>
                    <div className="text-default-500">媒体引擎</div>
                    <Value value={health.media_engine ?? 'unknown'} />
                  </div>
                </div>
                <details>
                  <summary className="cursor-pointer">完整健康数据</summary>
                  <Value value={health} />
                </details>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <div>
              <h1 className="text-xl font-bold">能力声明</h1>
              <p className="text-sm text-default-500">
                仅展示适配器实际返回的能力；不实现的能力给出原因。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            {capabilitiesError && (
              <div className="text-danger">{capabilitiesError}</div>
            )}
            {capabilities ? (
              <>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-default-500">实现</div>
                    <Value
                      value={`${capabilities.impl_name ?? 'unknown'} ${capabilities.impl_version ?? ''}`}
                    />
                  </div>
                  <div>
                    <div className="text-default-500">Milky</div>
                    <Value value={capabilities.milky_version ?? 'unknown'} />
                  </div>
                  <div>
                    <div className="text-default-500">支持动作</div>
                    <Value value={capabilities.apis ?? []} />
                  </div>
                  <div>
                    <div className="text-default-500">消息段</div>
                    <Value value={capabilities.message_segments ?? []} />
                  </div>
                  <div>
                    <div className="text-default-500">呼叫控制</div>
                    <Value value={capabilities.calls?.control ?? false} />
                  </div>
                  <div>
                    <div className="text-default-500">真实语音</div>
                    <Value value={capabilities.calls?.voice ?? false} />
                  </div>
                </div>
                {capabilities.calls?.voice === false && (
                  <div className="rounded-lg border border-warning bg-warning-50 p-3 text-warning-700 dark:text-warning-200">
                    当前实例未声明真实语音媒体。界面只提供能力允许的控制操作，不把控制测试记录为双向语音成功。
                  </div>
                )}
                {(capabilities.calls?.reason ||
                  (capabilities.limitations?.length ?? 0) > 0) && (
                  <details>
                    <summary className="cursor-pointer">限制说明</summary>
                    <Value
                      value={{
                        reason: capabilities.calls?.reason ?? null,
                        limitations: capabilities.limitations ?? []
                      }}
                    />
                  </details>
                )}
              </>
            ) : (
              !capabilitiesError && <div>尚无能力数据。</div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
