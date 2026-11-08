import { Button } from '@nextui-org/button'
import { Card, CardBody } from '@nextui-org/card'
import { useLocation, useNavigate } from 'react-router-dom'

import type { AdminCapability } from '@/types/admin'

export const AdminLoginHint = ({ reason }: { reason?: string }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const back = `${location.pathname}${location.search}`
  return (
    <Card className="bg-opacity-60 backdrop-blur-sm">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-default-600 dark:text-default-300">
          {reason ?? '管理会话未建立或已失效。请先登录当前实例的 /admin/v1。'}
        </div>
        <Button
          color="primary"
          variant="flat"
          onPress={() =>
            navigate(`/web_login?back=${encodeURIComponent(back)}`)
          }
        >
          前往管理登录
        </Button>
      </CardBody>
    </Card>
  )
}

export const CapabilityList = ({
  capabilities
}: {
  capabilities?: Record<string, AdminCapability>
}) => {
  if (!capabilities)
    return <div className="text-default-400">尚无能力声明。</div>
  const entries = Object.entries(capabilities)
  if (entries.length === 0) {
    return <div className="text-default-400">管理接口未返回能力项。</div>
  }
  return (
    <div className="grid gap-2">
      {entries.map(([name, capability]) => (
        <div
          key={name}
          className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-default-200 p-2 text-sm"
        >
          <div className="font-medium">{name}</div>
          <div
            className={
              capability.supported ? 'text-success' : 'text-default-500'
            }
          >
            {capability.supported ? '已支持' : '不可用'}
            {capability.reason && (
              <span className="ml-2 text-xs text-default-500">
                {capability.reason}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export const ErrorLine = ({ message }: { message?: string }) =>
  message ? <div className="text-sm text-danger">{message}</div> : null

export const WarningLine = ({ message }: { message?: string }) =>
  message ? <div className="text-sm text-warning">{message}</div> : null
