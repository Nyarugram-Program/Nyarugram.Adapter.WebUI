import { Button } from '@nextui-org/button'
import { CardBody, CardHeader } from '@nextui-org/card'
import { Image } from '@nextui-org/image'
import { Input } from '@nextui-org/input'
import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { IoKeyOutline } from 'react-icons/io5'
import { useNavigate } from 'react-router-dom'

import HoverEffectCard from '@/components/effect_card'
import { title } from '@/components/primitives'
import { ThemeSwitch } from '@/components/theme-switch'

import useInstance from '@/hooks/use-instance'

import { setAdminSessionMarker } from '@/utils/admin-session'
import { notifyAuthChanged } from '@/utils/auth-store'

import logo from '@/assets/images/logo.png'
import NyarugramAdminManager from '@/controllers/nyarugram_admin_manager'
import PureLayout from '@/layouts/pure'

export default function WebLoginPage() {
  const urlSearchParams = new URLSearchParams(window.location.search)
  const back = urlSearchParams.get('back') ?? ''
  const navigate = useNavigate()
  const { instance, invalidate } = useInstance()
  const [adminSecret, setAdminSecret] = useState('')
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    if (instance?.managementKind === 'none') {
      navigate(back && back.startsWith('/') ? back : '/', { replace: true })
    }
  }, [instance?.managementKind, back, navigate])

  const onAdminSubmit = async () => {
    if (!instance || instance.managementKind !== 'nyarugram-admin-v1') return
    if (!adminSecret) {
      toast.error('请输入管理凭据')
      return
    }
    setIsLoading(true)
    try {
      await NyarugramAdminManager.login(instance, 'default', adminSecret)
      setAdminSessionMarker(instance.id, true, instance.managementUrl)
      invalidate()
      notifyAuthChanged()
      setAdminSecret('')
      toast.success('管理会话已建立')
      navigate(back && back.startsWith('/') ? back : '/', { replace: true })
    } catch (error) {
      setAdminSessionMarker(instance.id, false, instance.managementUrl)
      notifyAuthChanged()
      toast.error((error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  const renderForm = () => {
    if (!instance) {
      return (
        <div className="grid gap-5 py-5 text-center">
          <div className="text-default-500">尚未选择适配器实例。</div>
          <Button color="primary" onPress={() => navigate('/instances')}>
            登记实例
          </Button>
        </div>
      )
    }

    if (instance.managementKind === 'none') {
      return (
        <div className="py-5 text-default-500">正在进入仅协议调试模式…</div>
      )
    }

    return (
      <>
        <Input
          isClearable
          isDisabled={isLoading}
          label="管理地址"
          value={instance.managementUrl}
          isReadOnly
        />
        <Input
          isClearable
          isDisabled={isLoading}
          label="管理凭据"
          placeholder="仅用于建立当前管理会话"
          type="password"
          value={adminSecret}
          onChange={(event) => setAdminSecret(event.target.value)}
          onClear={() => setAdminSecret('')}
          startContent={
            <IoKeyOutline className="text-black/50 mb-0.5 dark:text-white/90 text-slate-400 pointer-events-none flex-shrink-0" />
          }
        />
        <Button
          className="mx-10 mt-10 text-lg py-7"
          color="primary"
          isLoading={isLoading}
          radius="full"
          size="lg"
          variant="shadow"
          onPress={onAdminSubmit}
        >
          建立管理会话
        </Button>
      </>
    )
  }

  return (
    <>
      <title>登录 - Nyarugram Adapter WebUI</title>
      <PureLayout>
        <div className="w-[608px] max-w-full py-8 px-2 md:px-8 overflow-hidden">
          <HoverEffectCard
            className="items-center gap-4 pt-0 pb-6 bg-default-50"
            maxXRotation={3}
            maxYRotation={3}
          >
            <CardHeader className="inline-block max-w-lg text-center justify-center">
              <div className="flex items-center justify-center w-full gap-2 pt-10">
                <Image alt="logo" height="7em" src={logo} />
                <div>
                  <span className={title()}>Adapter&nbsp;</span>
                  <span className={title({ color: 'violet' })}>
                    Login&nbsp;
                  </span>
                </div>
              </div>
              <ThemeSwitch className="absolute right-4 top-4" />
            </CardHeader>

            <CardBody className="flex gap-5 py-5 px-5 md:px-10">
              {renderForm()}
              <Button
                className="mx-10"
                variant="light"
                onPress={() => navigate('/instances')}
              >
                管理适配器实例
              </Button>
            </CardBody>
          </HoverEffectCard>
        </div>
      </PureLayout>
    </>
  )
}
