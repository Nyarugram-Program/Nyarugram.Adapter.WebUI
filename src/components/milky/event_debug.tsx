import { Button } from '@nextui-org/button'
import { Card, CardBody, CardHeader } from '@nextui-org/card'
import { Input } from '@nextui-org/input'
import { Select, SelectItem } from '@nextui-org/select'
import { Switch } from '@nextui-org/switch'
import clsx from 'clsx'
import { EventSourcePolyfill } from 'event-source-polyfill'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReadyState } from 'react-use-websocket'
import useWebSocket from 'react-use-websocket'

import CodeEditor from '@/components/code_editor'

import useInstance from '@/hooks/use-instance'

import { getInstanceBusinessToken } from '@/utils/instance-secrets'
import { parseJson, stringifyJson } from '@/utils/json'
import {
  type EventScope,
  buildEventScope,
  normalizeConsumer
} from '@/utils/milky-event-scope'
import {
  type EventCursor,
  MAX_EVENTS,
  buildEventTransportUrl,
  buildServerConsumer,
  normalizeEventUrl,
  purgeLegacyEventCursors,
  readEventCursor,
  writeEventCursor
} from '@/utils/milky-events'

import { useEventIdentity } from './use-event-identity'
import { MilkyWsEventCursorState } from './ws-event-state'

interface DisplayEvent {
  key: string
  receivedAt: string
  transport: 'SSE' | 'WebSocket'
  kind: string
  eventType: string
  seq?: number
  eventId?: string
  epoch?: number
  raw: string
}

const appendEvent = (
  current: DisplayEvent[],
  event: Omit<DisplayEvent, 'key' | 'receivedAt'>
) =>
  [
    {
      ...event,
      key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      receivedAt: new Date().toLocaleTimeString()
    },
    ...current
  ].slice(0, MAX_EVENTS)

const EventList = ({ events }: { events: DisplayEvent[] }) => {
  const [filter, setFilter] = useState('')
  const filtered = events.filter(
    (event) =>
      !filter ||
      event.kind.includes(filter) ||
      event.eventType.includes(filter) ||
      event.raw.includes(filter)
  )

  return (
    <div className="grid gap-3">
      <Input
        label="过滤事件"
        placeholder="按类型、事件名或内容过滤"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="grid max-h-[36rem] gap-2 overflow-auto pr-1">
        {filtered.length === 0 && (
          <div className="text-default-400">暂无匹配事件。</div>
        )}
        {filtered.map((event) => (
          <div
            key={event.key}
            className={clsx(
              'rounded-lg border p-3 text-sm',
              event.kind === 'gap'
                ? 'border-warning bg-warning-50 dark:bg-warning-950'
                : event.kind === 'error'
                  ? 'border-danger bg-danger-50 dark:bg-danger-950'
                  : 'border-default-200 bg-default-50 dark:bg-default-100'
            )}
          >
            <div className="mb-2 flex flex-wrap gap-x-3 text-xs text-default-500">
              <span>{event.receivedAt}</span>
              <span>{event.transport}</span>
              <span>{event.kind}</span>
              {typeof event.seq === 'number' && <span>seq={event.seq}</span>}
              {typeof event.epoch === 'number' && (
                <span>epoch={event.epoch}</span>
              )}
              {event.eventId && <span>id={event.eventId}</span>}
              {event.eventType && <span>{event.eventType}</span>}
            </div>
            <pre className="whitespace-pre-wrap break-all">{event.raw}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

const StatusText = ({ state }: { state: string }) => (
  <span
    className={clsx(
      'rounded-full px-3 py-1 text-sm',
      state === '已连接'
        ? 'bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-200'
        : state === '连接中'
          ? 'bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-200'
          : 'bg-default-100 text-default-600 dark:bg-default-100 dark:text-default-300'
    )}
  >
    {state}
  </span>
)

interface EventPanelProps {
  scope: EventScope
  eventUrl: string
  token: string
  onReconnect: () => void
}

export const MilkySseEvents = ({
  scope,
  eventUrl,
  token,
  onReconnect
}: EventPanelProps) => {
  const [events, setEvents] = useState<DisplayEvent[]>([])
  const [state, setState] = useState('连接中')
  const cursorRef = useRef<EventCursor | undefined | null>(null)
  if (cursorRef.current === null) {
    cursorRef.current = readEventCursor(scope)
  }
  const [lastCursor, setLastCursor] = useState<number | undefined>(
    () => cursorRef.current?.cursor
  )
  const [lastError, setLastError] = useState('')

  const updateCursor = useCallback(
    (seq: number) => {
      const previous = cursorRef.current
      if (previous && seq <= previous.cursor) return false
      const next = { epoch: previous?.epoch ?? 0, cursor: seq }
      cursorRef.current = next
      setLastCursor(seq)
      writeEventCursor(scope, next)
      return true
    },
    [scope]
  )

  // The parent re-confirms identity and remounts this panel on reconnect. A
  // new connection therefore always reads the latest persisted cursor.
  const reconnect = onReconnect

  useEffect(() => {
    let closed = false
    let source: EventSourcePolyfill | undefined
    let reconnectRequested = false

    // Capture the processed cursor once per connection. Later event updates
    // must not change the URL or the dependency list of a healthy connection.
    const startCursor = cursorRef.current?.cursor
    const sourceUrl = buildEventTransportUrl(scope, eventUrl, {
      cursor: startCursor
    })
    const headers: Record<string, string> = {
      Accept: 'text/event-stream'
    }
    if (token) headers.Authorization = `Bearer ${token}`
    if (typeof startCursor === 'number') {
      // 显式恢复：SSE 用 Last-Event-ID 指定位置，服务端按该位置回放。
      headers['Last-Event-ID'] = String(startCursor)
    }

    const handleMessage = (message: MessageEvent<string>) => {
      if (closed) return
      const rawSeq = message.lastEventId
        ? Number(message.lastEventId)
        : undefined
      const seq =
        typeof rawSeq === 'number' && Number.isSafeInteger(rawSeq)
          ? rawSeq
          : undefined

      let parsed: Record<string, unknown>
      try {
        parsed = parseJson(message.data) as Record<string, unknown>
      } catch {
        setEvents((current) =>
          appendEvent(current, {
            transport: 'SSE',
            kind: 'error',
            eventType: 'parse_error',
            raw: message.data
          })
        )
        return
      }

      const framed =
        parsed.type === 'nyarugram_event' &&
        typeof parsed.event === 'object' &&
        parsed.event !== null
          ? (parsed.event as Record<string, unknown>)
          : parsed
      const eventType =
        typeof framed.event_type === 'string'
          ? framed.event_type
          : typeof parsed.event_type === 'string'
            ? parsed.event_type
            : 'unknown'

      if (eventType === 'nyarugram_events_gap') {
        setLastError(
          '事件存在缺口：服务端已无法回放更早的事件，请按缺口信息重新同步状态。'
        )
        setEvents((current) =>
          appendEvent(current, {
            transport: 'SSE',
            kind: 'gap',
            eventType,
            seq,
            raw: stringifyJson(parsed, 2)
          })
        )
        return
      }

      if (seq !== undefined) {
        // 重复或更旧的 seq 不重复显示，但仍视为已处理位置。
        if (!updateCursor(seq)) return
      }

      setEvents((current) =>
        appendEvent(current, {
          transport: 'SSE',
          kind: 'event',
          eventType,
          seq,
          raw: stringifyJson(parsed, 2)
        })
      )
    }

    const connect = () => {
      if (closed) return
      setState('连接中')
      setLastError('')
      try {
        source = new EventSourcePolyfill(sourceUrl, {
          headers,
          withCredentials: true
        })
      } catch (error) {
        setState('连接失败')
        setLastError((error as Error).message)
        return
      }

      source.onopen = () => {
        if (closed) return
        setState('已连接')
      }
      source.onmessage = (event) => handleMessage(event as MessageEvent<string>)
      // 服务端使用具名事件 milky_event；onmessage 只接收未命名事件。
      source.addEventListener('milky_event', (event) =>
        handleMessage(event as MessageEvent<string>)
      )
      source.onerror = () => {
        if (closed || reconnectRequested) return
        reconnectRequested = true
        setState('等待重连')
        setLastError('SSE 连接中断；重新确认服务和账号身份后重连。')
        source?.close()
        reconnect()
      }
    }

    connect()

    return () => {
      closed = true
      source?.close()
    }
  }, [eventUrl, token, scope, updateCursor, reconnect])

  return (
    <Card className="bg-opacity-60 backdrop-blur-sm">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">事件流（SSE）</h2>
          <p className="text-sm text-default-500">
            重连时使用 Last-Event-ID 恢复；SSE 没有客户端
            ACK，确认位置由服务端按发送进度推进。
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <StatusText state={state} />
          {lastCursor !== undefined && <span>cursor={lastCursor}</span>}
        </div>
      </CardHeader>
      <CardBody className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="flat" onPress={reconnect}>
            重连并恢复
          </Button>
          <span className="text-xs text-default-500">
            连接会使用当前已处理位置作为 Last-Event-ID，不会丢失内存中的游标。
          </span>
        </div>
        {lastError && <div className="text-sm text-warning">{lastError}</div>}
        <EventList events={events} />
      </CardBody>
    </Card>
  )
}

export const MilkyWsEvents = ({
  scope,
  eventUrl,
  token,
  extensionEnabled,
  onReconnect
}: EventPanelProps & { extensionEnabled: boolean }) => {
  const cursorStateRef = useRef<MilkyWsEventCursorState | null>(null)
  if (cursorStateRef.current === null) {
    cursorStateRef.current = new MilkyWsEventCursorState(scope)
  }
  const [events, setEvents] = useState<DisplayEvent[]>([])
  const [state, setState] = useState('连接中')
  const [epoch, setEpoch] = useState(() => cursorStateRef.current?.epoch ?? 0)
  const [cursor, setCursor] = useState<number | undefined>(
    () => cursorStateRef.current?.cursor
  )
  const [ackedSeq, setAckedSeq] = useState<number>()
  const [lastError, setLastError] = useState('')
  const sendJsonMessageRef = useRef<((value: unknown) => void) | null>(null)
  const activeRef = useRef(true)
  const reconnectRequestedRef = useRef(false)

  useEffect(
    () => () => {
      activeRef.current = false
      cursorStateRef.current?.close()
    },
    []
  )

  const sendResume = useCallback(() => {
    if (!activeRef.current) return
    const current = cursorStateRef.current?.pendingResume()
    if (!extensionEnabled || !current) return
    if (!sendJsonMessageRef.current) return
    sendJsonMessageRef.current({
      type: 'nyarugram_resume',
      extension_version: 1,
      epoch: current.epoch,
      cursor: current.cursor
    })
    cursorStateRef.current?.clearPendingResume()
  }, [extensionEnabled])

  const socketUrl = useMemo(
    () =>
      buildEventTransportUrl(scope, eventUrl, {
        token,
        ack: extensionEnabled,
        // The local cursor is only a starting hint. After this connection starts,
        // reconnects use the server's durable position for this consumer.
        cursor: cursorStateRef.current?.cursor
      }),
    [scope, eventUrl, token, extensionEnabled]
  )

  const { sendJsonMessage, readyState } = useWebSocket(socketUrl, {
    onOpen: () => {
      if (!activeRef.current) return
      reconnectRequestedRef.current = false
      setState('已连接')
      setLastError('')
      // 正常重连使用服务端保存的消费位置；resume 只在用户显式点击时发送，
      // 避免把与服务器起点相同的本地游标当作无效回退。
    },
    onClose: () => {
      if (!activeRef.current) return
      setState('等待重连')
      setLastError('连接已关闭；重新确认服务和账号身份后重连。')
      if (!reconnectRequestedRef.current) {
        reconnectRequestedRef.current = true
        onReconnect()
      }
    },
    onError: () => {
      if (!activeRef.current) return
      setState('连接失败')
      setLastError('WebSocket 连接失败；重新确认服务和账号身份后重连。')
      if (!reconnectRequestedRef.current) {
        reconnectRequestedRef.current = true
        onReconnect()
      }
    },
    onMessage: (message) => {
      if (!activeRef.current) return
      const raw = String(message.data)
      let parsed: Record<string, unknown>
      try {
        parsed = parseJson(raw) as Record<string, unknown>
      } catch {
        setEvents((current) =>
          appendEvent(current, {
            transport: 'WebSocket',
            kind: 'error',
            eventType: 'parse_error',
            raw
          })
        )
        return
      }

      const frame = parsed as {
        type?: string
        epoch?: number
        seq?: number
        event_id?: string
        event_type?: string
        event?: Record<string, unknown>
        cursor?: number
        requested_cursor?: number
        oldest_available?: number
        reason?: string
      }

      if (frame.type === 'nyarugram_resumed') {
        const result =
          cursorStateRef.current?.handleResumed(frame.epoch, frame.cursor) ?? {}
        if (result.epoch !== undefined) setEpoch(result.epoch)
        if (result.cursor !== undefined) setCursor(result.cursor)
        setEvents((current) =>
          appendEvent(current, {
            transport: 'WebSocket',
            kind: 'control',
            eventType: 'nyarugram_resumed',
            epoch: result.epoch,
            seq: result.cursor,
            raw: stringifyJson(parsed, 2)
          })
        )
        return
      }

      if (frame.type === 'nyarugram_events_gap') {
        setLastError(
          `事件存在缺口：requested=${frame.requested_cursor ?? 'unknown'}，oldest=${frame.oldest_available ?? 'unknown'}。缺口不能静默跳过，请重新同步状态。`
        )
        setEvents((current) =>
          appendEvent(current, {
            transport: 'WebSocket',
            kind: 'gap',
            eventType: 'nyarugram_events_gap',
            raw: stringifyJson(parsed, 2)
          })
        )
        return
      }

      if (frame.type === 'nyarugram_ack_rejected') {
        // 退避一次，让重复投递可以重新确认。
        cursorStateRef.current?.handleAckRejected(frame.seq, frame.epoch)
        setLastError(
          `ACK 被拒绝：${frame.reason ?? '位置或代际不匹配'}。等待重复投递后重试。`
        )
        setEvents((current) =>
          appendEvent(current, {
            transport: 'WebSocket',
            kind: 'error',
            eventType: frame.type ?? 'nyarugram_ack_rejected',
            seq: frame.seq,
            raw: stringifyJson(parsed, 2)
          })
        )
        return
      }

      if (frame.type === 'nyarugram_resume_rejected') {
        const serverEpoch =
          typeof frame.epoch === 'number' ? frame.epoch : undefined
        const retry = cursorStateRef.current?.handleResumeRejected(serverEpoch)
        if (retry) sendResume()
        setLastError(
          `恢复被拒绝：${frame.reason ?? '游标不可用'}。当前 epoch=${serverEpoch ?? cursorStateRef.current?.epoch ?? 0}。`
        )
        setEvents((current) =>
          appendEvent(current, {
            transport: 'WebSocket',
            kind: 'error',
            eventType: frame.type ?? 'nyarugram_resume_rejected',
            seq: frame.cursor,
            epoch: serverEpoch,
            raw: stringifyJson(parsed, 2)
          })
        )
        return
      }

      if (extensionEnabled && frame.type === 'nyarugram_event') {
        const outcome = cursorStateRef.current?.handleEvent(
          frame,
          stringifyJson(frame.event ?? parsed, 2)
        )
        if (!outcome) return
        if (outcome.error) setLastError(outcome.error)
        if (outcome.view) {
          setEvents((current) =>
            appendEvent(current, {
              transport: 'WebSocket',
              kind: 'event',
              eventType: outcome.view!.eventType,
              seq: outcome.view!.seq,
              eventId: outcome.view!.eventId,
              epoch: outcome.view!.epoch,
              raw: outcome.view!.raw
            })
          )
        }
        if (outcome.epoch !== undefined) setEpoch(outcome.epoch)
        if (outcome.cursor !== undefined) setCursor(outcome.cursor)
        if (outcome.ackedSeq !== undefined) setAckedSeq(outcome.ackedSeq)
        // 重复投递同样需要 ACK：ACK 是幂等确认，不是显示副作用。
        if (outcome.ack) {
          sendJsonMessage({
            type: 'nyarugram_ack',
            extension_version: 1,
            epoch: outcome.ack.epoch,
            seq: outcome.ack.seq
          })
        }
        return
      }

      const standardEventType =
        typeof parsed.event_type === 'string' ? parsed.event_type : 'unknown'
      setEvents((current) =>
        appendEvent(current, {
          transport: 'WebSocket',
          kind: standardEventType === 'nyarugram_events_gap' ? 'gap' : 'event',
          eventType: standardEventType,
          raw: stringifyJson(parsed, 2)
        })
      )
    },
    shouldReconnect: () => false
  })

  useEffect(() => {
    sendJsonMessageRef.current = sendJsonMessage
  }, [sendJsonMessage])

  useEffect(() => {
    if (readyState === ReadyState.CONNECTING) setState('连接中')
    if (readyState === ReadyState.CLOSED) setState('等待重连')
  }, [readyState])

  return (
    <Card className="bg-opacity-60 backdrop-blur-sm">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">事件流（WebSocket）</h2>
          <p className="text-sm text-default-500">
            ACK
            在页面处理并去重后发送；重复投递仍会再次确认。断线重连使用服务端保存的消费位置。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusText state={state} />
          <span>epoch={epoch}</span>
          {cursor !== undefined && <span>cursor={cursor}</span>}
          {ackedSeq !== undefined && <span>acked={ackedSeq}</span>}
        </div>
      </CardHeader>
      <CardBody className="grid gap-3">
        {extensionEnabled && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="flat"
              isDisabled={
                readyState !== ReadyState.OPEN || cursor === undefined
              }
              onPress={() => {
                if (cursorStateRef.current?.cursor === undefined) {
                  setLastError('尚无已处理游标，无法显式恢复。')
                  return
                }
                if (readyState === ReadyState.OPEN) sendResume()
              }}
            >
              按当前游标显式恢复
            </Button>
            <span className="text-xs text-default-500">
              resume 会携带当前 epoch 和位置；服务端返回新 epoch
              后丢弃旧代际去重集合。
            </span>
          </div>
        )}
        {lastError && <div className="text-sm text-warning">{lastError}</div>}
        <EventList events={events} />
      </CardBody>
    </Card>
  )
}

export default function MilkyEventDebug() {
  const { instance, generation } = useInstance()
  const [token, setToken] = useState('')
  const [appliedToken, setAppliedToken] = useState('')
  const [transport, setTransport] = useState<'sse' | 'ws'>('ws')
  const [extensionEnabled, setExtensionEnabled] = useState(true)
  const [consumer, setConsumer] = useState('nyarugram-webui')

  useEffect(() => {
    if (!instance) {
      setToken('')
      setAppliedToken('')
      return
    }
    const stored = getInstanceBusinessToken(instance.id)
    setToken(stored)
    setAppliedToken(stored)
  }, [instance?.id])

  useEffect(() => {
    if (!instance) return
    // v1/v2 cursors have no service or account ownership. Discard them instead
    // of assigning them to whichever account happens to be logged in now.
    purgeLegacyEventCursors(instance.id)
  }, [instance?.id])

  useEffect(() => {
    if (!instance || instance.managementKind !== 'none') return
    const timer = window.setTimeout(() => setAppliedToken(token), 700)
    return () => window.clearTimeout(timer)
  }, [token, instance?.id, instance?.managementKind])

  const identityToken = instance?.managementKind === 'none' ? appliedToken : ''

  const { state: identity, retryNow } = useEventIdentity({
    instance,
    generation,
    token: identityToken,
    enabled: instance?.protocol === 'milky'
  })

  const normalizedConsumer = normalizeConsumer(consumer)
  const consumerValid = normalizedConsumer.length <= 128

  const scope = useMemo(() => {
    if (!instance || identity.status !== 'ready' || !consumerValid) {
      return undefined
    }
    if (
      instance.managementKind === 'none' &&
      identity.token !== identityToken
    ) {
      return undefined
    }
    return buildEventScope({
      instance,
      transport,
      consumer: normalizedConsumer,
      account: identity.account
    })
  }, [
    instance,
    identity,
    identityToken,
    transport,
    normalizedConsumer,
    consumerValid
  ])

  if (!instance || instance.protocol !== 'milky') {
    return (
      <div className="p-4">
        <Card>
          <CardBody>当前实例不是 Milky。</CardBody>
        </Card>
      </div>
    )
  }

  const eventUrl = instance.eventUrl
  const effectiveExtension = transport === 'ws' && extensionEnabled
  const connectionToken =
    instance.managementKind === 'none'
      ? identity.status === 'ready'
        ? identity.token
        : ''
      : token

  let resolvedUrl = ''
  let urlError = ''
  if (eventUrl) {
    try {
      resolvedUrl = normalizeEventUrl(eventUrl, transport)
    } catch (error) {
      urlError = (error as Error).message
    }
  }

  return (
    <>
      <title>Milky 事件 - Nyarugram Adapter WebUI</title>
      <div className="grid gap-4 p-4">
        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Input
              isReadOnly
              label="事件入口"
              value={eventUrl || '实例未配置事件入口'}
            />
            <Input
              label="业务访问令牌"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <Select
              label="传输"
              selectedKeys={[transport]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0]
                if (value === 'sse' || value === 'ws') {
                  setTransport(value)
                }
              }}
            >
              <SelectItem key="ws">WebSocket</SelectItem>
              <SelectItem key="sse">SSE</SelectItem>
            </Select>
            <Input
              label="消费者"
              value={consumer}
              onChange={(event) => setConsumer(event.target.value)}
            />
            <div className="flex items-end gap-4">
              <Switch
                isDisabled={transport !== 'ws'}
                isSelected={transport === 'ws' && extensionEnabled}
                onValueChange={setExtensionEnabled}
              >
                Nyarugram ACK
              </Switch>
            </div>
          </CardBody>
        </Card>

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardBody className="grid gap-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">事件消费身份</div>
              <Button
                size="sm"
                variant="flat"
                onPress={() => {
                  setAppliedToken(token)
                  retryNow()
                }}
              >
                重新确认身份
              </Button>
            </div>
            {identity.status === 'loading' && (
              <div className="text-default-400">正在确认服务与账号身份…</div>
            )}
            {identity.status === 'error' && (
              <div className="text-warning">
                {identity.reason}
                {identity.retryable && (
                  <span className="ml-2 text-xs text-default-500">
                    自动重试中（已尝试 {identity.attempt + 1} 次）
                  </span>
                )}
              </div>
            )}
            {identity.status === 'ready' && scope && (
              <>
                <div className="break-all">
                  账号：{identity.account.label}（{identity.account.value}）
                </div>
                <div className="break-all text-xs text-default-500">
                  服务作用域：{scope.serviceIdentity || '未配置入口'}
                </div>
                <div className="break-all text-xs text-default-500">
                  服务器消费者：{buildServerConsumer(scope)}
                </div>
                <div className="break-all text-xs text-default-500">
                  游标作用域：{scope.key}
                </div>
              </>
            )}
            {instance.managementKind === 'none' && (
              <div className="text-xs text-default-500">
                仅协议调试模式通过业务接口 get_login_info
                确认账号；令牌或账号变化后不会继承旧作用域游标。
              </div>
            )}
            {instance.managementKind === 'none' &&
              identity.status === 'ready' &&
              identity.token !== token && (
                <div className="text-xs text-warning">
                  令牌已修改；确认新身份前不会使用未确认的令牌建立事件连接。
                </div>
              )}
          </CardBody>
        </Card>

        {(!eventUrl || urlError) && (
          <Card>
            <CardBody className="text-warning">
              {urlError ||
                '请在实例管理中显式配置事件入口（http(s):// 用于 SSE，ws(s):// 用于 WebSocket）；不会根据业务地址或端口猜测。'}
            </CardBody>
          </Card>
        )}

        {!consumerValid && (
          <Card>
            <CardBody className="text-warning">
              消费者名称长度不能超过 128 个字符。
            </CardBody>
          </Card>
        )}

        {eventUrl && !urlError && scope && (
          <>
            <div className="text-xs text-default-500">
              实际连接：{resolvedUrl}
            </div>
            {transport === 'sse' ? (
              <MilkySseEvents
                key={`${scope.key}-sse-${generation}`}
                eventUrl={resolvedUrl}
                onReconnect={retryNow}
                scope={scope}
                token={connectionToken}
              />
            ) : (
              <MilkyWsEvents
                key={`${scope.key}-ws-${effectiveExtension}-${generation}`}
                eventUrl={resolvedUrl}
                extensionEnabled={effectiveExtension}
                onReconnect={retryNow}
                scope={scope}
                token={connectionToken}
              />
            )}
          </>
        )}

        <Card className="bg-opacity-60 backdrop-blur-sm">
          <CardHeader>
            <h2 className="text-lg font-bold">扩展帧参考</h2>
          </CardHeader>
          <CardBody>
            <CodeEditor
              height="180px"
              language="json"
              value={stringifyJson(
                {
                  client_ack: {
                    type: 'nyarugram_ack',
                    extension_version: 1,
                    epoch: 0,
                    seq: 42
                  },
                  client_resume: {
                    type: 'nyarugram_resume',
                    extension_version: 1,
                    epoch: 0,
                    cursor: 40
                  }
                },
                2
              )}
              options={{ readOnly: true }}
            />
          </CardBody>
        </Card>
      </div>
    </>
  )
}
