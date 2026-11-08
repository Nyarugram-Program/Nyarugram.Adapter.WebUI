import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildEventScope } from '@/utils/milky-event-scope'
import { readEventCursor } from '@/utils/milky-events'

import type { AdapterInstance } from '@/types/instance'

import { MilkySseEvents } from './event_debug'

const { FakeEventSource, sources } = vi.hoisted(() => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    url: string
    options: Record<string, unknown>
    closed = false
    onopen: (() => void) | null = null
    onmessage: ((event: unknown) => void) | null = null
    onerror: (() => void) | null = null
    listeners = new Map<string, Array<(event: unknown) => void>>()

    constructor(url: string, options: Record<string, unknown>) {
      this.url = url
      this.options = options
      FakeEventSource.instances.push(this)
    }

    addEventListener(type: string, callback: (event: unknown) => void) {
      const list = this.listeners.get(type) ?? []
      list.push(callback)
      this.listeners.set(type, list)
    }

    close() {
      this.closed = true
    }

    emitOpen() {
      this.onopen?.()
    }

    emitServerEvent(data: string, lastEventId: string) {
      const event = { data, lastEventId }
      for (const callback of this.listeners.get('milky_event') ?? []) {
        callback(event)
      }
    }

    emitError() {
      this.onerror?.()
    }
  }
  return { FakeEventSource, sources: FakeEventSource.instances }
})

vi.mock('@/components/code_editor', () => ({
  default: () => null
}))

vi.mock('event-source-polyfill', () => ({
  EventSourcePolyfill: FakeEventSource
}))

vi.mock('@nextui-org/card', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@nextui-org/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
  }) => (
    <button disabled={isDisabled} onClick={() => onPress?.()}>
      {children}
    </button>
  )
}))

vi.mock('@nextui-org/input', () => ({
  Input: ({
    label,
    value,
    onChange
  }: {
    label?: string
    value?: string
    onChange?: React.ChangeEventHandler<HTMLInputElement>
  }) => <input aria-label={label} value={value ?? ''} onChange={onChange} />
}))

const instance = (
  overrides: Partial<AdapterInstance> = {}
): AdapterInstance => ({
  id: 'instance-a',
  name: 'A',
  protocol: 'milky',
  managementKind: 'nyarugram-admin-v1',
  managementUrl: 'https://adapter.example/admin/v1',
  businessUrl: 'https://adapter.example',
  eventUrl: 'wss://adapter.example/event',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
  ...overrides
})

const scopeFor = (account = 'admin:account-a') =>
  buildEventScope({
    instance: instance(),
    transport: 'sse',
    consumer: 'web',
    account: { value: account, label: account }
  })

const eventData = (text: string) =>
  JSON.stringify({
    time: 1,
    self_id: 100001,
    event_type: 'message_receive',
    data: {
      message_scene: 'friend',
      segments: [{ type: 'text', data: { text } }]
    }
  })

const PanelHarness = ({
  scope,
  onReconnect
}: {
  scope: ReturnType<typeof scopeFor>
  onReconnect: () => void
}) => {
  const [key, setKey] = useState(0)
  return (
    <MilkySseEvents
      key={key}
      eventUrl="https://adapter.example/event"
      onReconnect={() => {
        onReconnect()
        setKey((value) => value + 1)
      }}
      scope={scope}
      token="token-1"
    />
  )
}

const renderPanel = (
  scope: ReturnType<typeof scopeFor>,
  onReconnect = vi.fn()
) => render(<PanelHarness onReconnect={onReconnect} scope={scope} />)

beforeEach(() => {
  sources.length = 0
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('MilkySseEvents connection lifecycle', () => {
  it('keeps one healthy connection across multiple events', () => {
    const scope = scopeFor()
    const onReconnect = vi.fn()
    renderPanel(scope, onReconnect)

    expect(sources).toHaveLength(1)
    const source = sources[0]
    act(() => {
      source.emitOpen()
      source.emitServerEvent(eventData('one'), '1')
      source.emitServerEvent(eventData('two'), '2')
    })

    expect(sources).toHaveLength(1)
    expect(source.closed).toBe(false)
    expect(onReconnect).not.toHaveBeenCalled()
    expect(readEventCursor(scope)).toEqual({ epoch: 0, cursor: 2 })
    expect(screen.getByText(/one/)).toBeTruthy()
    expect(screen.getByText(/two/)).toBeTruthy()
  })

  it('explicit reconnect closes the old connection and starts one with the latest cursor', () => {
    const scope = scopeFor()
    const onReconnect = vi.fn()
    renderPanel(scope, onReconnect)

    const first = sources[0]
    act(() => {
      first.emitServerEvent(eventData('one'), '1')
      first.emitServerEvent(eventData('two'), '2')
    })
    fireEvent.click(screen.getByRole('button', { name: '重连并恢复' }))

    expect(first.closed).toBe(true)
    expect(sources).toHaveLength(2)
    const second = sources[1]
    expect(second.url).toContain('nyarugram_cursor=2')
    expect(
      (second.options.headers as Record<string, string>)['Last-Event-ID']
    ).toBe('2')
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('failure recovery uses the latest cursor and creates exactly one new connection', () => {
    const scope = scopeFor()
    const onReconnect = vi.fn()
    renderPanel(scope, onReconnect)

    const first = sources[0]
    act(() => {
      first.emitServerEvent(eventData('one'), '1')
      first.emitError()
    })

    expect(first.closed).toBe(true)
    expect(sources).toHaveLength(2)
    const second = sources[1]
    expect(second.url).toContain('nyarugram_cursor=1')
    expect(
      (second.options.headers as Record<string, string>)['Last-Event-ID']
    ).toBe('1')
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('does not let a late event from an old scope update the new panel', () => {
    const scopeA = scopeFor('admin:account-a')
    const firstView = renderPanel(scopeA, vi.fn())
    const firstSource = sources[0]
    act(() => {
      firstSource.emitServerEvent(eventData('old-scope-event'), '1')
    })
    firstView.unmount()

    const scopeB = scopeFor('admin:account-b')
    renderPanel(scopeB, vi.fn())
    expect(sources).toHaveLength(2)
    const secondSource = sources[1]
    expect(secondSource.url).toContain('expected_identity=admin%3Aaccount-b')

    act(() => {
      firstSource.emitServerEvent(eventData('late-old-event'), '2')
    })

    expect(screen.queryByText(/late-old-event/)).toBeNull()
    expect(screen.queryByText(/old-scope-event/)).toBeNull()
    expect(readEventCursor(scopeA)).toEqual({ epoch: 0, cursor: 1 })
    expect(readEventCursor(scopeB)).toBeUndefined()
  })
})
