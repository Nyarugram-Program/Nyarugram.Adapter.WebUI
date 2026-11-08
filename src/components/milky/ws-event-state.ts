import type { EventScope } from '@/utils/milky-event-scope'
import {
  type EventCursor,
  MAX_EVENTS,
  readEventCursor,
  writeEventCursor
} from '@/utils/milky-events'

export interface WsEventFrame {
  epoch?: number
  seq?: number
  event_id?: string
  event_type?: string
  event?: Record<string, unknown>
}

export interface WsEventView {
  kind: 'event'
  eventType: string
  seq?: number
  eventId?: string
  epoch?: number
  raw: string
}

export interface WsEventOutcome {
  view?: WsEventView
  ack?: { epoch: number; seq: number }
  epoch?: number
  cursor?: number
  ackedSeq?: number
  error?: string
}

const boundSet = <T>(set: Set<T>) =>
  set.size > MAX_EVENTS ? new Set(Array.from(set).slice(-MAX_EVENTS)) : set

/**
 * The ACK/epoch/dedupe state machine for one event scope. It is intentionally
 * separate from React so late socket callbacks can be tested after close().
 */
export class MilkyWsEventCursorState {
  private epochValue = 0
  private cursorValue?: number
  private eventIds = new Set<string>()
  private acked = new Set<string>()
  private pending?: EventCursor
  private resumeRetry = 0
  private closed = false

  constructor(private readonly scope: EventScope) {
    const stored = readEventCursor(scope)
    this.epochValue = stored?.epoch ?? 0
    this.cursorValue = stored?.cursor
    if (stored) this.pending = stored
  }

  close() {
    this.closed = true
  }

  get epoch() {
    return this.epochValue
  }

  get cursor() {
    return this.cursorValue
  }

  pendingResume(): EventCursor | undefined {
    if (this.closed) return undefined
    if (this.pending) return this.pending
    if (this.cursorValue === undefined) return undefined
    return { epoch: this.epochValue, cursor: this.cursorValue }
  }

  clearPendingResume() {
    this.pending = undefined
  }

  handleResumed(epoch?: number, cursor?: number) {
    if (this.closed) return {}
    const nextEpoch = typeof epoch === 'number' ? epoch : this.epochValue
    this.adoptEpoch(nextEpoch)
    if (typeof cursor === 'number') {
      this.cursorValue = cursor
      this.writeCursor()
    }
    this.pending = undefined
    return { epoch: nextEpoch, cursor: this.cursorValue }
  }

  handleAckRejected(seq?: number, epoch?: number) {
    if (this.closed || typeof seq !== 'number') return
    const key = `${typeof epoch === 'number' ? epoch : this.epochValue}:${seq}`
    this.acked.delete(key)
    this.acked = boundSet(this.acked)
  }

  handleResumeRejected(epoch?: number): EventCursor | undefined {
    if (this.closed) return undefined
    const previousCursor = this.cursorValue
    if (typeof epoch === 'number') {
      this.adoptEpoch(epoch)
      // The rejection tells us the server epoch, but the retry must carry the
      // position we were trying to restore.
      this.cursorValue = previousCursor
    }
    if (
      typeof epoch === 'number' &&
      this.resumeRetry < 1 &&
      previousCursor !== undefined
    ) {
      this.resumeRetry += 1
      this.pending = { epoch, cursor: previousCursor }
      return this.pending
    }
    return undefined
  }

  handleEvent(frame: WsEventFrame, raw: string): WsEventOutcome {
    if (this.closed) return {}
    const frameEpoch =
      typeof frame.epoch === 'number' ? frame.epoch : this.epochValue
    if (frameEpoch < this.epochValue) {
      return {
        error: `收到旧代际事件（epoch=${frameEpoch}，当前=${this.epochValue}），已丢弃且不会发送 ACK。`
      }
    }
    if (frameEpoch > this.epochValue) this.adoptEpoch(frameEpoch)

    const seq = frame.seq
    const eventId = frame.event_id
    const duplicate =
      (!!eventId && this.eventIds.has(`${frameEpoch}:${eventId}`)) ||
      (typeof seq === 'number' && this.acked.has(`${frameEpoch}:${seq}`))

    const view = duplicate
      ? undefined
      : {
          kind: 'event' as const,
          eventType: frame.event_type ?? 'unknown',
          seq,
          eventId,
          epoch: frameEpoch,
          raw
        }

    if (!duplicate && eventId) {
      this.eventIds.add(`${frameEpoch}:${eventId}`)
      this.eventIds = boundSet(this.eventIds)
    }

    if (typeof seq === 'number' && Number.isSafeInteger(seq)) {
      this.acked.add(`${frameEpoch}:${seq}`)
      this.acked = boundSet(this.acked)
      // A duplicate delivery still advances a position that was processed but
      // not persisted before a crash; ACK remains idempotent.
      if (this.cursorValue === undefined || seq > this.cursorValue) {
        this.cursorValue = seq
        this.writeCursor()
      }
      return {
        view,
        ack: { epoch: frameEpoch, seq },
        epoch: frameEpoch,
        cursor: this.cursorValue,
        ackedSeq: seq
      }
    }

    return {
      view,
      epoch: frameEpoch,
      cursor: this.cursorValue
    }
  }

  private adoptEpoch(nextEpoch: number) {
    if (nextEpoch === this.epochValue) return
    this.epochValue = nextEpoch
    this.cursorValue = undefined
    // Old-generation dedupe must not suppress new-generation events.
    this.eventIds = new Set()
    this.acked = new Set()
    this.pending = undefined
  }

  private writeCursor() {
    if (this.cursorValue === undefined) return
    writeEventCursor(this.scope, {
      epoch: this.epochValue,
      cursor: this.cursorValue
    })
  }
}
