import type { AdminLogEntry, AdminLogPage } from '@/types/admin'

export const DEFAULT_LOG_CAPACITY = 1000

const streamIdOf = (entry: AdminLogEntry) => entry.stream_id ?? 'legacy'

const timeOf = (entry: AdminLogEntry) => {
  const value = Date.parse(entry.timestamp)
  return Number.isFinite(value) ? value : 0
}

const idOf = (entry: AdminLogEntry) => {
  if (/^\d+$/.test(entry.id)) {
    try {
      return BigInt(entry.id)
    } catch {
      return undefined
    }
  }
  return undefined
}

const compareEntries = (left: AdminLogEntry, right: AdminLogEntry) => {
  const time = timeOf(right) - timeOf(left)
  if (time !== 0) return time
  const leftId = idOf(left)
  const rightId = idOf(right)
  if (leftId !== undefined && rightId !== undefined) {
    if (leftId === rightId) return 0
    return leftId > rightId ? -1 : 1
  }
  if (left.id === right.id) return 0
  return left.id > right.id ? -1 : 1
}

const entryKey = (entry: AdminLogEntry) => `${streamIdOf(entry)}:${entry.id}`

const streamStartedAt = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Single merge owner for history pages and the live SSE stream. It is used as an
 * external store so the component never replaces the list with whichever request
 * happens to finish last.
 */
export class AdminLogStream {
  private entries: AdminLogEntry[] = []
  private streamId = ''
  private streamStartedAtValue = ''
  private closed = false
  private listeners = new Set<() => void>()

  constructor(private readonly capacity = DEFAULT_LOG_CAPACITY) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.entries

  getStreamId = () => this.streamId

  close = () => {
    this.closed = true
    this.listeners.clear()
  }

  clear = () => {
    if (this.closed) return
    this.entries = []
    this.emit()
  }

  applyHistory = (page: AdminLogPage) => {
    if (this.closed) return
    this.merge(page.entries ?? [], page.stream_id, page.stream_started_at)
  }

  append = (entry: AdminLogEntry) => {
    if (this.closed) return
    this.merge([entry], entry.stream_id, entry.stream_started_at)
  }

  private adoptStream(streamId: string, startedAt?: string) {
    this.entries = []
    this.streamId = streamId
    this.streamStartedAtValue = startedAt ?? ''
  }

  private merge(
    incoming: AdminLogEntry[],
    streamId?: string,
    startedAt?: string
  ) {
    if (incoming.length === 0 && !streamId) return

    const nextStreamId = streamId || this.streamId || 'legacy'
    const incomingStart = streamStartedAt(startedAt)
    const currentStart = streamStartedAt(this.streamStartedAtValue)

    if (streamId && this.streamId && streamId !== this.streamId) {
      // A late page from a previous process must not wipe the new stream.
      if (
        incomingStart !== undefined &&
        currentStart !== undefined &&
        incomingStart < currentStart
      ) {
        return
      }
      this.adoptStream(streamId, startedAt)
    } else if (streamId && !this.streamId) {
      this.adoptStream(streamId, startedAt)
    } else if (streamId) {
      this.streamId = streamId
      if (startedAt) this.streamStartedAtValue = startedAt
    }

    const effectiveStream = this.streamId || nextStreamId
    const merged = new Map<string, AdminLogEntry>()
    for (const entry of this.entries) {
      merged.set(entryKey(entry), entry)
    }
    for (const entry of incoming) {
      const normalized = entry.stream_id
        ? entry
        : { ...entry, stream_id: effectiveStream }
      merged.set(entryKey(normalized), normalized)
    }

    const sorted = Array.from(merged.values()).sort(compareEntries)
    this.entries = sorted.slice(0, this.capacity)
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }
}
