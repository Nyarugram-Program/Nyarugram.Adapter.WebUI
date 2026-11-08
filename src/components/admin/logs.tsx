import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { Select, SelectItem } from '@nextui-org/select'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'

import useInstance from '@/hooks/use-instance'

import NyarugramAdminManager, {
  AdminRequestError
} from '@/controllers/nyarugram_admin_manager'
import type { AdminLogEntry } from '@/types/admin'

import { AdminLogStream, DEFAULT_LOG_CAPACITY } from './log-merge'
import { AdminLoginHint, ErrorLine } from './shared'

const levels = ['Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical']

const levelClass = (level: string) => {
  switch (level.toLowerCase()) {
    case 'critical':
    case 'error':
      return 'text-danger'
    case 'warning':
      return 'text-warning'
    case 'debug':
    case 'trace':
      return 'text-default-400'
    default:
      return 'text-default-600 dark:text-default-300'
  }
}

const entryKey = (entry: AdminLogEntry) =>
  `${entry.stream_id ?? 'legacy'}:${entry.id}`

export default function AdminLogsPage() {
  const { instance, generation } = useInstance()
  const [level, setLevel] = useState('Information')
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [unauthorized, setUnauthorized] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const historyAbortRef = useRef<AbortController | undefined>(undefined)

  const sessionKey = instance
    ? [
        instance.id,
        instance.managementUrl,
        instance.managementKind,
        generation,
        level
      ].join('|')
    : 'no-instance'

  // A new instance/entry/generation/level gets a new merge owner. Old history
  // responses and old SSE callbacks can only touch their closed controller.
  const stream = useMemo(
    () => new AdminLogStream(DEFAULT_LOG_CAPACITY),
    [sessionKey]
  )
  const entries = useSyncExternalStore(
    stream.subscribe,
    stream.getSnapshot,
    stream.getSnapshot
  )

  useEffect(
    () => () => {
      stream.close()
    },
    [stream]
  )

  useEffect(() => {
    setError('')
    setUnauthorized(false)
  }, [sessionKey])

  useEffect(() => {
    if (!instance || instance.managementKind !== 'nyarugram-admin-v1') return
    if (paused) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    historyAbortRef.current = controller
    let disposed = false
    setLoading(true)
    setError('')

    NyarugramAdminManager.getLogs(
      instance,
      { level, limit: 200 },
      controller.signal
    )
      .then((page) => {
        if (disposed) return
        // Merge, never replace: SSE entries may already be in this controller.
        stream.applyHistory(page)
        if (page.dropped) {
          setError(`有 ${page.dropped} 条日志因有界缓冲被丢弃。`)
        }
      })
      .catch((requestError) => {
        if (disposed || controller.signal.aborted) return
        if (
          requestError instanceof AdminRequestError &&
          requestError.status === 401
        ) {
          setUnauthorized(true)
        } else {
          setError((requestError as Error).message)
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })

    return () => {
      disposed = true
      controller.abort()
      if (historyAbortRef.current === controller) {
        historyAbortRef.current = undefined
      }
    }
  }, [instance, generation, level, paused, refreshNonce, stream])

  useEffect(() => {
    if (!instance || instance.managementKind !== 'nyarugram-admin-v1') return
    if (paused) return

    let disposed = false
    const source = NyarugramAdminManager.getLogsStream(instance, {
      level,
      onEntry: (entry) => {
        if (!disposed) stream.append(entry)
      },
      onError: () => {
        if (!disposed) {
          setError('日志流连接中断，浏览器会按 EventSource 策略重连。')
        }
      }
    })

    return () => {
      disposed = true
      source.close()
    }
  }, [instance, generation, level, paused, refreshNonce, stream])

  const filtered = useMemo(() => {
    const value = filter.trim().toLowerCase()
    if (!value) return entries
    return entries.filter(
      (entry) =>
        entry.message.toLowerCase().includes(value) ||
        entry.source.toLowerCase().includes(value) ||
        entry.level.toLowerCase().includes(value)
    )
  }, [entries, filter])

  if (!instance) {
    return (
      <div className="p-4">
        <Card>
          <CardBody>尚未选择适配器实例。</CardBody>
        </Card>
      </div>
    )
  }

  if (instance.managementKind !== 'nyarugram-admin-v1') {
    return (
      <div className="p-4">
        <Card>
          <CardBody>当前实例未配置 Nyarugram /admin/v1 管理接口。</CardBody>
        </Card>
      </div>
    )
  }

  const streamId = entries[0]?.stream_id

  return (
    <>
      <title>管理日志 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4">
        {unauthorized && <AdminLoginHint />}
        <ErrorLine message={error} />
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">管理日志</h1>
              <p className="text-sm text-default-500">
                日志由管理接口提供并已脱敏；页面只读取有界缓冲，不访问任意文件路径。
              </p>
              {streamId && (
                <p className="break-all text-xs text-default-400">
                  日志流：{streamId}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="日志级别"
                className="w-36"
                selectedKeys={[level]}
                size="sm"
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0]
                  if (typeof value === 'string') setLevel(value)
                }}
              >
                {levels.map((item) => (
                  <SelectItem key={item}>{item}</SelectItem>
                ))}
              </Select>
              <Input
                aria-label="过滤日志"
                className="w-56"
                placeholder="按文本过滤"
                size="sm"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <Button
                size="sm"
                variant="flat"
                onPress={() => setPaused((value) => !value)}
              >
                {paused ? '继续接收' : '暂停接收'}
              </Button>
              <Button size="sm" variant="flat" onPress={() => stream.clear()}>
                清空
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => setRefreshNonce((value) => value + 1)}
              >
                刷新
              </Button>
            </div>
          </CardHeader>
          <CardBody className="grid gap-2">
            {loading && <div className="text-default-400">正在读取日志…</div>}
            {!loading && filtered.length === 0 && (
              <div className="text-default-400">暂无日志。</div>
            )}
            <div className="grid max-h-[calc(100vh_-_18rem)] gap-1 overflow-auto rounded-lg bg-black/80 p-3 font-mono text-xs text-default-100">
              {filtered.map((entry) => (
                <div key={entryKey(entry)} className="break-all">
                  <span className="text-default-500">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>{' '}
                  <span className={levelClass(entry.level)}>
                    [{entry.level}]
                  </span>{' '}
                  <span className="text-primary-300">{entry.source}</span>{' '}
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
