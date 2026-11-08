import {
  BugIcon2,
  InfoIcon,
  RouteIcon,
  SettingsIcon,
  SignalTowerIcon,
  TerminalIcon
} from '@/components/icons'

import type { AdapterInstance } from '@/types/instance'

export type SiteConfig = typeof siteConfig
export interface MenuItem {
  label: string
  icon?: React.ReactNode
  autoOpen?: boolean
  href?: string
  items?: MenuItem[]
  customIcon?: string
}

const iconClassName = 'w-5 h-5'
const icons = {
  base: (
    <div className={iconClassName}>
      <RouteIcon />
    </div>
  ),
  network: (
    <div className={iconClassName}>
      <SignalTowerIcon />
    </div>
  ),
  settings: (
    <div className={iconClassName}>
      <SettingsIcon />
    </div>
  ),
  logs: (
    <div className={iconClassName}>
      <TerminalIcon />
    </div>
  ),
  debug: (
    <div className={iconClassName}>
      <BugIcon2 />
    </div>
  ),
  info: (
    <div className={iconClassName}>
      <InfoIcon />
    </div>
  )
}

export const siteConfig = {
  name: 'Nyarugram Adapter WebUI',
  description: 'Nyarugram 适配器管理界面，支持 OneBot V11 与 Milky。',
  navItems: [
    { label: '基础信息', icon: icons.base, href: '/' },
    { label: '网络配置', icon: icons.network, href: '/network' },
    { label: '其他配置', icon: icons.settings, href: '/config' },
    { label: '系统日志', icon: icons.logs, href: '/logs' },
    {
      label: '接口调试',
      icon: icons.debug,
      items: [
        { label: 'HTTP', href: '/debug/http' },
        { label: 'Websocket', href: '/debug/ws' }
      ]
    },
    { label: '关于', icon: icons.info, href: '/about' }
  ] as MenuItem[],
  links: {
    github: 'https://github.com/NapNeko/NapCatQQ',
    docs: 'https://napcat.napneko.icu/'
  }
}

export const getMenuItems = (instance?: AdapterInstance): MenuItem[] => {
  const instanceItem: MenuItem = {
    label: '实例管理',
    icon: icons.settings,
    href: '/instances'
  }

  if (instance?.managementKind === 'nyarugram-admin-v1') {
    const items: MenuItem[] = [
      instanceItem,
      { label: '管理概览', icon: icons.base, href: '/' },
      { label: '适配器配置', icon: icons.settings, href: '/config' },
      { label: '系统日志', icon: icons.logs, href: '/logs' },
      {
        label: '协议调试',
        icon: icons.debug,
        items: [
          { label: 'HTTP', href: '/debug/http' },
          { label: '事件', href: '/debug/ws' }
        ]
      }
    ]
    if (instance.protocol === 'milky') {
      items.push({ label: '通话控制', icon: icons.network, href: '/calls' })
    }
    items.push({ label: '关于', icon: icons.info, href: '/about' })
    return items
  }

  if (instance?.protocol === 'milky') {
    return [
      instanceItem,
      { label: '实例概览', icon: icons.base, href: '/' },
      {
        label: '协议调试',
        icon: icons.debug,
        items: [
          { label: 'Milky HTTP', href: '/debug/http' },
          { label: 'Milky 事件', href: '/debug/ws' }
        ]
      },
      { label: '通话控制', icon: icons.network, href: '/calls' },
      { label: '关于', icon: icons.info, href: '/about' }
    ]
  }

  if (instance?.protocol === 'onebot11') {
    if (instance.managementKind === 'none') {
      return [
        instanceItem,
        { label: '协议概览', icon: icons.base, href: '/' },
        {
          label: '接口调试',
          icon: icons.debug,
          items: [
            { label: 'HTTP', href: '/debug/http' },
            { label: 'Websocket', href: '/debug/ws' }
          ]
        },
        { label: '关于', icon: icons.info, href: '/about' }
      ]
    }
    return [
      instanceItem,
      { label: '基础信息', icon: icons.base, href: '/' },
      { label: '网络配置', icon: icons.network, href: '/network' },
      { label: '其他配置', icon: icons.settings, href: '/config' },
      { label: '系统日志', icon: icons.logs, href: '/logs' },
      {
        label: '接口调试',
        icon: icons.debug,
        items: [
          { label: 'HTTP', href: '/debug/http' },
          { label: 'Websocket', href: '/debug/ws' }
        ]
      },
      { label: '关于', icon: icons.info, href: '/about' }
    ]
  }

  return [instanceItem]
}
