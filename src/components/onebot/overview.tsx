import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import axios from 'axios'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import useInstance from '@/hooks/use-instance'

import { stringifyJson } from '@/utils/json'
import {
  getOneBotBusinessToken,
  getOneBotBusinessUrl
} from '@/utils/onebot-debug'

export default function OneBotOverviewPage() {
  const { instance } = useInstance()
  const navigate = useNavigate()
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!instance) {
    return (
      <div className="p-4">
        <Card>
          <CardBody>尚未选择适配器实例。</CardBody>
        </Card>
      </div>
    )
  }

  if (instance.protocol !== 'onebot11') {
    return (
      <div className="p-4">
        <Card>
          <CardBody>当前实例不是 OneBot V11。</CardBody>
        </Card>
      </div>
    )
  }

  const businessUrl = instance.businessUrl || getOneBotBusinessUrl(instance.id)
  const businessToken = getOneBotBusinessToken(instance.id)

  const testConnection = async () => {
    if (!businessUrl) {
      setError('实例未配置 OneBot HTTP 业务地址')
      return
    }
    setLoading(true)
    setError('')
    setResult('')
    try {
      const response = await axios.post(
        `${businessUrl.replace(/\/+$/, '')}/get_status`,
        {},
        {
          headers: businessToken
            ? { Authorization: `Bearer ${businessToken}` }
            : {},
          responseType: 'text',
          validateStatus: () => true,
          timeout: 8000
        }
      )
      const body = String(response.data)
      let isJson = true
      try {
        JSON.parse(body)
      } catch {
        isJson = false
      }
      const warning = isJson
        ? ''
        : '[警告] 响应不是 JSON；请确认业务地址指向 OneBot HTTP 服务，而不是静态站点或代理回退页面。\n\n'
      setResult(`${warning}HTTP ${response.status}\n\n${body.slice(0, 20000)}`)
    } catch (requestError) {
      setError((requestError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <title>OneBot 概览 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <div>
              <h1 className="text-xl font-bold">仅协议调试</h1>
              <p className="text-sm text-default-500">
                当前实例没有管理接口。账号登录、配置保存、管理日志和运行指标不可用；
                OneBot 业务 HTTP/WebSocket 调试仍可使用。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm">
            <div className="rounded-lg border border-default-200 p-3">
              <div className="text-default-500">协议</div>
              <div>OneBot V11</div>
            </div>
            <div className="rounded-lg border border-default-200 p-3">
              <div className="text-default-500">管理模式</div>
              <div>仅协议调试（无 /admin/v1）</div>
            </div>
            <div className="rounded-lg border border-default-200 p-3">
              <div className="text-default-500">业务 HTTP</div>
              <div className="break-all">
                {businessUrl || '未配置；请在实例管理中显式填写'}
              </div>
            </div>
            <div className="rounded-lg border border-default-200 p-3">
              <div className="text-default-500">事件入口</div>
              <div className="break-all">
                {instance.eventUrl || '未配置；可在事件调试页单独填写'}
              </div>
            </div>
            <div className="rounded-lg border border-default-200 p-3">
              <div className="text-default-500">业务访问令牌</div>
              <div>{businessToken ? '当前浏览器会话已保存' : '未保存'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                color="primary"
                isLoading={loading}
                onPress={testConnection}
              >
                调用 get_status
              </Button>
              <Button variant="flat" onPress={() => navigate('/debug/http')}>
                HTTP 调试
              </Button>
              <Button variant="flat" onPress={() => navigate('/debug/ws')}>
                WebSocket 调试
              </Button>
              <Button variant="flat" onPress={() => navigate('/instances')}>
                实例管理
              </Button>
            </div>
            {error && <div className="text-danger">{error}</div>}
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <h2 className="text-xl font-bold">业务响应</h2>
          </CardHeader>
          <CardBody>
            {result ? (
              <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap break-all text-sm">
                {result}
              </pre>
            ) : (
              <pre className="whitespace-pre-wrap break-all text-sm text-default-400">
                {stringifyJson(
                  {
                    note: '点击“调用 get_status”后显示真实 HTTP 状态与响应；未成功时不会伪造结果。'
                  },
                  2
                )}
              </pre>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
