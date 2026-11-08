import { BreadcrumbItem, Breadcrumbs } from '@nextui-org/breadcrumbs'
import { Button } from '@nextui-org/button'
import { useLocalStorage } from '@uidotdev/usehooks'
import clsx from 'clsx'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { MdMenu, MdMenuOpen } from 'react-icons/md'
import { useLocation, useNavigate } from 'react-router-dom'

import key from '@/const/key'

import errorFallbackRender from '@/components/error_fallback'
import SideBar from '@/components/sidebar'

import useAuth from '@/hooks/auth'
import useInstance from '@/hooks/use-instance'

import { getMenuItems, type MenuItem } from '@/config/site'
import QQManager from '@/controllers/qq_manager'

const findTitle = (menus: MenuItem[], pathname: string): string[] => {
  const paths: string[] = []

  if (pathname) {
    for (const item of menus) {
      if (item.href === pathname) {
        paths.push(item.label)
      } else if (item.items) {
        const title = findTitle(item.items, pathname)

        if (title.length > 0) {
          paths.push(item.label)
          paths.push(...title)
        }
      }
    }
  }

  return paths
}

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [openSideBar, setOpenSideBar] = useState(true)
  const [b64img] = useLocalStorage(key.backgroundImage, '')
  const navigate = useNavigate()
  const { isAuth } = useAuth()
  const { instance } = useInstance()
  const menus = useMemo(() => getMenuItems(instance), [instance])

  const checkIsQQLogin = async () => {
    try {
      const result = await QQManager.checkQQLoginStatus()
      if (!result.isLogin) {
        navigate('/qq_login', { replace: true })
      }
    } catch {
      navigate('/web_login', { replace: true })
    }
  }

  useEffect(() => {
    contentRef?.current?.scrollTo?.({
      top: 0,
      behavior: 'smooth'
    })
  }, [location.pathname])

  useEffect(() => {
    if (
      isAuth &&
      instance?.protocol === 'onebot11' &&
      instance.managementKind === 'napcat'
    ) {
      checkIsQQLogin()
    }
  }, [isAuth, instance?.id, instance?.protocol, instance?.managementKind])

  const title = useMemo(() => {
    return findTitle(menus, location.pathname)
  }, [menus, location.pathname])

  return (
    <div
      className="h-screen relative flex bg-danger-50 dark:bg-black"
      style={{
        backgroundImage: `url(${b64img})`,
        backgroundSize: 'cover'
      }}
    >
      <SideBar items={menus} open={openSideBar} />
      <div
        ref={contentRef}
        className={clsx(
          'overflow-y-auto relative flex-1 rounded-md m-1 bg-content1 pb-10 md:pb-0',
          openSideBar ? 'ml-0' : 'ml-1',
          !b64img && 'shadow-inner',
          b64img && '!bg-opacity-50 backdrop-blur-none dark:bg-background'
        )}
      >
        <div className="h-10 flex items-center hm-medium text-xl sticky top-2 left-0 backdrop-blur-lg z-20 shadow-sm bg-background dark:bg-background shadow-danger-50 dark:shadow-danger-100 m-2 rounded-full !bg-opacity-50">
          <motion.div
            className={clsx(
              'mr-1 ease-in-out ml-0 md:relative',
              openSideBar && 'pl-2 absolute',
              'md:!ml-0 md:pl-0'
            )}
            transition={{ type: 'spring', stiffness: 150, damping: 15 }}
            initial={{ marginLeft: 0 }}
            animate={{ marginLeft: openSideBar ? '15rem' : 0 }}
          >
            <Button
              isIconOnly
              radius="full"
              variant="light"
              onPress={() => setOpenSideBar(!openSideBar)}
            >
              {openSideBar ? <MdMenuOpen size={24} /> : <MdMenu size={24} />}
            </Button>
          </motion.div>
          <Breadcrumbs isDisabled size="lg">
            {title?.map((item, index) => (
              <BreadcrumbItem key={index}>{item}</BreadcrumbItem>
            ))}
          </Breadcrumbs>
        </div>
        <ErrorBoundary fallbackRender={errorFallbackRender}>
          {children}
        </ErrorBoundary>
      </div>
    </div>
  )
}

export default Layout
