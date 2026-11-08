import { Button } from '@nextui-org/button'
import { Card, CardBody } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import ChatInputModal from '@/components/chat_input/modal'
import OneBotMessageList from '@/components/onebot/message_list'
import OneBotSendModal from '@/components/onebot/send_modal'
import WSStatus from '@/components/onebot/ws_status'

import useInstance from '@/hooks/use-instance'
import { useWebSocketDebug } from '@/hooks/use-websocket-debug'

import {
  getOneBotBusinessToken,
  getOneBotBusinessUrl,
  setOneBotBusinessToken,
  setOneBotBusinessUrl
} from '@/utils/onebot-debug'

export default function WSDebug() {
  const { instance } = useInstance()
  const instanceId = instance?.id ?? ''
  const [socketConfig, setSocketConfig] = useState({
    url: instance?.eventUrl || getOneBotBusinessUrl(instanceId),
    token: getOneBotBusinessToken(instanceId)
  })
  const [inputUrl, setInputUrl] = useState(socketConfig.url)
  const [inputToken, setInputToken] = useState(socketConfig.token)

  useEffect(() => {
    const nextUrl = instance?.eventUrl || getOneBotBusinessUrl(instanceId)
    const nextToken = getOneBotBusinessToken(instanceId)
    setSocketConfig({ url: nextUrl, token: nextToken })
    setInputUrl(nextUrl)
    setInputToken(nextToken)
  }, [instance?.eventUrl, instanceId])

  const { sendMessage, readyState, FilterMessagesType, filteredMessages } =
    useWebSocketDebug(socketConfig.url, socketConfig.token)

  const handleConnect = useCallback(() => {
    if (!inputUrl.startsWith('ws://') && !inputUrl.startsWith('wss://')) {
      toast.error('WebSocket URL 不合法')
      return
    }
    setOneBotBusinessUrl(instanceId, inputUrl.trim())
    setOneBotBusinessToken(instanceId, inputToken.trim())
    setSocketConfig({
      url: inputUrl.trim(),
      token: inputToken.trim()
    })
  }, [inputUrl, inputToken, instanceId])

  return (
    <>
      <title>Websocket调试 - Nyarugram Adapter WebUI</title>
      <div className="h-[calc(100vh-4rem)] overflow-hidden flex flex-col">
        <Card className="mx-2 mt-2 flex-shrink-0 bg-opacity-50 backdrop-blur-sm">
          <CardBody className="gap-2">
            <div className="grid gap-2 items-center md:grid-cols-5">
              <Input
                className="col-span-2"
                label="WebSocket URL"
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="显式输入 OneBot WebSocket 地址"
              />
              <Input
                className="col-span-2"
                label="Token"
                type="text"
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                placeholder="输入 Token"
              />
              <div className="flex-shrink-0 flex gap-2 col-span-2 md:col-span-1">
                <Button
                  color="danger"
                  onPress={handleConnect}
                  size="lg"
                  radius="full"
                  className="w-full md:w-auto"
                >
                  连接
                </Button>
              </div>
            </div>
            <div className="p-2 border border-default-100 bg-content1 bg-opacity-50 rounded-md dark:bg-[rgb(30,30,30)]">
              <div className="grid gap-2 md:grid-cols-5 items-center md:w-fit">
                <WSStatus state={readyState} />
                <div className="md:w-64 max-w-full col-span-2">
                  {FilterMessagesType}
                </div>
                <OneBotSendModal sendMessage={sendMessage} />
                <ChatInputModal />
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="flex-1 overflow-hidden">
          <OneBotMessageList messages={filteredMessages} />
        </div>
      </div>
    </>
  )
}
