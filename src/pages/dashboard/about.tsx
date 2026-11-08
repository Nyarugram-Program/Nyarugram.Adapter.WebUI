import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Chip } from '@nextui-org/chip'
import { Image } from '@nextui-org/image'
import { Link } from '@nextui-org/link'

import { BietiaopIcon, GithubIcon, WebUIIcon } from '@/components/icons'
import { title } from '@/components/primitives'

import logo from '@/assets/images/logo.png'

import packageJson from '../../../package.json'

export default function AboutPage() {
  return (
    <>
      <title>关于 Nyarugram Adapter WebUI</title>
      <section className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
        <div className="max-w-full w-[900px] px-5 flex flex-col items-center">
          <div className="flex flex-col md:flex-row items-center">
            <Image
              alt="logo"
              className="flex-shrink-0 w-52 md:w-48 mr-2"
              src={logo}
            />
            <div className="flex -mt-9 md:mt-0">
              <WebUIIcon />
            </div>
          </div>
          <div className="flex opacity-60 items-center gap-2 mb-5 font-ubuntu">
            Created By
            <div className="flex scale-80 -ml-5 -mr-5">
              <BietiaopIcon />
            </div>
          </div>
          <div className="mb-6 flex items-center gap-2">
            <Chip color="primary" size="lg">
              WebUI v{packageJson.version}
            </Chip>
            <Chip color="secondary" size="lg">
              Milky + OneBot V11
            </Chip>
          </div>
          <Card className="mb-6 max-w-2xl bg-opacity-60 backdrop-blur-sm">
            <CardHeader>
              <h1 className={title({ color: 'cyan', shadow: true })}>
                项目说明
              </h1>
            </CardHeader>
            <CardBody className="gap-3 text-sm leading-6 text-default-600 dark:text-default-300">
              <p>
                Nyarugram Adapter WebUI 基于 NapCat WebUI 的 MIT
                许可源码改造，用于管理 OneBot V11 与 Milky
                适配器实例，并保留原协议调试能力。
              </p>
              <p>
                页面只连接部署者显式登记的实例。未实现或未配置的能力会显示真实原因，不会伪造保存成功、在线状态或媒体能力。
              </p>
              <p>
                当前版本默认不加载在线音乐、一言、公网头像或统计脚本；上游技术链接仅在用户点击后访问。
              </p>
              <div className="flex flex-wrap gap-3">
                <Link isExternal href="https://github.com/bietiaop/NextNapCatWebUI">
                  <GithubIcon className="w-6 h-6" /> 原 WebUI 上游
                </Link>
                <Link isExternal href="https://github.com/NapNeko/NapCatQQ">
                  <GithubIcon className="w-6 h-6" /> NapCat
                </Link>
                <Link isExternal href="https://milky.ntqqrev.org/">
                  Milky 文档
                </Link>
                <Link href="./LICENSE" target="_blank">
                  MIT License
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>
    </>
  )
}
