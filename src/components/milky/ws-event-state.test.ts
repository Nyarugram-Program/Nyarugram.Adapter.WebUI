import { beforeEach, describe, expect, it } from 'vitest'

import { buildEventScope } from '@/utils/milky-event-scope'
import { readEventCursor, writeEventCursor } from '@/utils/milky-events'

import type { AdapterInstance } from '@/types/instance'

import { MilkyWsEventCursorState } from './ws-event-state'

const instance: AdapterInstance = {
  id: 'instance-a',
  name: 'A',
  protocol: 'milky',
  managementKind: 'nyarugram-admin-v1',
  managementUrl: 'https://adapter.example/admin/v1',
  businessUrl: 'https://adapter.example',
  eventUrl: 'wss://adapter.example/event',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z'
}

const scopeFor = (account = 'admin:account-a') =>
  buildEventScope({
    instance,
    transport: 'ws',
    consumer: 'web',
    account: { value: account, label: account }
  })

const frame = (seq: number, epoch = 0, eventId?: string) => ({
  type: 'nyarugram_event',
  extension_version: 1,
  epoch,
  seq,
  event_id: eventId,
  event_type: 'message_receive',
  event: { event_type: 'message_receive' }
})

beforeEach(() => {
  sessionStorage.clear()
})

describe('MilkyWsEventCursorState', () => {
  it('acks a new event and persists the scoped cursor', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    const outcome = state.handleEvent(frame(1, 0, 'msg:1'), '{}')

    expect(outcome.view).toMatchObject({ eventType: 'message_receive', seq: 1 })
    expect(outcome.ack).toEqual({ epoch: 0, seq: 1 })
    expect(outcome.cursor).toBe(1)
    expect(readEventCursor(scope)).toEqual({ epoch: 0, cursor: 1 })
  })

  it('acks a duplicate delivery without displaying it again', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    state.handleEvent(frame(1, 0, 'msg:1'), '{}')
    const duplicate = state.handleEvent(frame(1, 0, 'msg:1'), '{}')

    expect(duplicate.view).toBeUndefined()
    expect(duplicate.ack).toEqual({ epoch: 0, seq: 1 })
  })

  it('advances the cursor for a duplicate event id with a newer seq', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    state.handleEvent(frame(1, 0, 'msg:1'), '{}')
    const duplicate = state.handleEvent(frame(4, 0, 'msg:1'), '{}')

    expect(duplicate.view).toBeUndefined()
    expect(duplicate.ack).toEqual({ epoch: 0, seq: 4 })
    expect(readEventCursor(scope)).toEqual({ epoch: 0, cursor: 4 })
  })

  it('adopts a new epoch and accepts the same event id in the new generation', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    state.handleEvent(frame(1, 0, 'msg:1'), '{}')
    const resumed = state.handleResumed(1, 1)
    const replay = state.handleEvent(frame(1, 1, 'msg:1'), '{}')

    expect(resumed).toEqual({ epoch: 1, cursor: 1 })
    expect(replay.view).toBeDefined()
    expect(replay.ack).toEqual({ epoch: 1, seq: 1 })
    expect(readEventCursor(scope)).toEqual({ epoch: 1, cursor: 1 })
  })

  it('drops an old epoch without sending an ACK', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    state.handleResumed(2, 7)
    const late = state.handleEvent(frame(8, 1), '{}')

    expect(late.view).toBeUndefined()
    expect(late.ack).toBeUndefined()
    expect(late.error).toContain('旧代际')
  })

  it('does not let a closed state process late events or write cursors', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    state.handleEvent(frame(1), '{}')
    const before = readEventCursor(scope)
    state.close()
    const late = state.handleEvent(frame(2), '{}')

    expect(late).toEqual({})
    expect(readEventCursor(scope)).toEqual(before)
  })

  it('resumes from a stored scoped cursor and retries a rejection once', () => {
    const scope = scopeFor()
    writeEventCursor(scope, { epoch: 4, cursor: 12 })
    const state = new MilkyWsEventCursorState(scope)

    expect(state.pendingResume()).toEqual({ epoch: 4, cursor: 12 })
    const retry = state.handleResumeRejected(5)
    expect(retry).toEqual({ epoch: 5, cursor: 12 })
    expect(state.handleResumeRejected(5)).toBeUndefined()
  })

  it('does not share epoch or cursor between different account scopes', () => {
    const accountA = scopeFor('admin:account-a')
    const accountB = scopeFor('admin:account-b')
    const stateA = new MilkyWsEventCursorState(accountA)
    stateA.handleEvent(frame(9, 6), '{}')

    const stateB = new MilkyWsEventCursorState(accountB)
    expect(stateB.epoch).toBe(0)
    expect(stateB.cursor).toBeUndefined()

    const outcome = stateB.handleEvent(frame(1, 0), '{}')
    expect(outcome.view).toBeDefined()
    expect(outcome.ack).toEqual({ epoch: 0, seq: 1 })
  })

  it('re-displays a rejected ACK when the event has no stable event id', () => {
    const scope = scopeFor()
    const state = new MilkyWsEventCursorState(scope)
    state.handleEvent(frame(3), '{}')
    state.handleAckRejected(3)
    const replay = state.handleEvent(frame(3), '{}')

    expect(replay.view).toBeDefined()
    expect(replay.ack).toEqual({ epoch: 0, seq: 3 })
  })
})
