import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { useLocation, useNavigate } from 'react-router-dom'

import { title } from '@/components/primitives'

import PureLayout from '@/layouts/pure'

export default function RemovedRoutePage() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <>
      <title>入口已移除 - Nyarugram Adapter WebUI</title>
      <PureLayout>
        <div className="w-[640px] max-w-full px-4 py-8">
          <Card className="bg-opacity-60 backdrop-blur-sm">
            <CardHeader className="flex flex-col items-start gap-1">
              <h1 className={title({ color: 'violet' })}>入口已移除</h1>
              <p className="text-sm text-default-500">{location.pathname}</p>
            </CardHeader>
            <CardBody className="gap-4 text-sm leading-6 text-default-600 dark:text-default-300">
              <p>
                NapCat 专属管理页（QQ
                扫码、快捷登录及管理令牌登录）已在本版本移除， 不再请求 NapCat
                管理接口，也不会根据旧管理端口推断业务地址。
              </p>
              <p>
                OneBot V11 请在实例管理中登记显式的业务 HTTP/WebSocket
                地址，并使用协议调试页操作；Milky 请使用 Nyarugram /admin/v1
                或仅协议调试模式。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button color="primary" onPress={() => navigate('/')}>
                  返回首页
                </Button>
                <Button variant="flat" onPress={() => navigate('/instances')}>
                  实例管理
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </PureLayout>
    </>
  )
}
