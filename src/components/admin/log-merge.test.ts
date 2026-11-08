import { describe, expect, it } from 'vitest'

import type { AdminLogEntry, AdminLogPage } from '@/types/admin'

import { AdminLogStream } from './log-merge'

const BASE = Date.parse('2026-11-08T00:00:00.000Z')

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const entry = (
  id: string,
  offsetMs: number,
  streamId = 'stream-a',
  startedAt = '2026-11-08T00:00:00.000Z',
  message = `message-${id}`
): AdminLogEntry => ({
  id,
  timestamp: new Date(BASE + offsetMs).toISOString(),
  level: 'Information',
  source: 'test',
  message,
  stream_id: streamId,
  stream_started_at: startedAt
})

const ids = (stream: AdminLogStream) =>
  stream.getSnapshot().map((item) => `${item.stream_id}:${item.id}`)

describe('AdminLogStream merge', () => {
  it('keeps live entries when history arrives later', () => {
    const stream = new AdminLogStream(10)
    stream.append(entry('2', 2000))
    stream.append(entry('3', 3000))
    stream.applyHistory({
      entries: [entry('1', 1000), entry('2', 2000)],
      stream_id: 'stream-a',
      stream_started_at: '2026-11-08T00:00:00.000Z'
    })

    expect(ids(stream)).toEqual(['stream-a:3', 'stream-a:2', 'stream-a:1'])
  })

  it('produces the same result when history arrives first', () => {
    const stream = new AdminLogStream(10)
    stream.applyHistory({
      entries: [entry('1', 1000), entry('2', 2000)],
      stream_id: 'stream-a',
      stream_started_at: '2026-11-08T00:00:00.000Z'
    })
    stream.append(entry('3', 3000))

    expect(ids(stream)).toEqual(['stream-a:3', 'stream-a:2', 'stream-a:1'])
  })

  it('converges for different interleavings', () => {
    const first = new AdminLogStream(10)
    first.append(entry('2', 2000))
    first.applyHistory({
      entries: [entry('1', 1000), entry('3', 3000)],
      stream_id: 'stream-a'
    })

    const second = new AdminLogStream(10)
    second.applyHistory({
      entries: [entry('1', 1000), entry('3', 3000)],
      stream_id: 'stream-a'
    })
    second.append(entry('2', 2000))

    expect(ids(first)).toEqual(ids(second))
  })

  it('deduplicates the same stream and id exactly once', () => {
    const stream = new AdminLogStream(10)
    stream.append(entry('1', 1000))
    stream.append(entry('1', 1000))
    stream.applyHistory({
      entries: [entry('1', 1000), entry('2', 2000)],
      stream_id: 'stream-a'
    })

    expect(ids(stream)).toEqual(['stream-a:2', 'stream-a:1'])
  })

  it('sorts equal timestamps by the numeric id without precision loss', () => {
    const stream = new AdminLogStream(10)
    stream.append(entry('2', 1000))
    stream.append(entry('10', 1000))

    expect(ids(stream)).toEqual(['stream-a:10', 'stream-a:2'])
  })

  it('truncates the list and keeps dedupe consistent with retained entries', () => {
    const stream = new AdminLogStream(2)
    stream.append(entry('1', 1000))
    stream.append(entry('2', 2000))
    stream.append(entry('3', 3000))

    expect(ids(stream)).toEqual(['stream-a:3', 'stream-a:2'])

    // A retained id stays single; a dropped id can be considered again.
    stream.append(entry('2', 2000))
    stream.append(entry('1', 1000))
    expect(ids(stream)).toEqual(['stream-a:3', 'stream-a:2'])

    stream.clear()
    stream.append(entry('1', 1000))
    expect(ids(stream)).toEqual(['stream-a:1'])
  })

  it('resets id collisions when the log stream identity changes', () => {
    const stream = new AdminLogStream(10)
    stream.append(entry('1', 1000, 'stream-a'))
    stream.append(entry('2', 2000, 'stream-a'))

    stream.append(
      entry('1', 1000, 'stream-b', '2026-11-08T00:01:00.000Z', 'new-process-1')
    )

    expect(ids(stream)).toEqual(['stream-b:1'])
    expect(stream.getSnapshot()[0].message).toBe('new-process-1')
  })

  it('ignores a late history page from an older process', () => {
    const stream = new AdminLogStream(10)
    stream.append(
      entry('1', 1000, 'stream-b', '2026-11-08T00:01:00.000Z', 'new-process')
    )

    stream.applyHistory({
      entries: [entry('1', 1000, 'stream-a', '2026-11-08T00:00:00.000Z')],
      stream_id: 'stream-a',
      stream_started_at: '2026-11-08T00:00:00.000Z'
    })

    expect(ids(stream)).toEqual(['stream-b:1'])
    expect(stream.getSnapshot()[0].message).toBe('new-process')
  })

  it('ignores late entries after the controller is closed', () => {
    const stream = new AdminLogStream(10)
    stream.append(entry('1', 1000))
    const before = stream.getSnapshot()
    stream.close()
    stream.append(entry('2', 2000))
    stream.applyHistory({ entries: [entry('3', 3000)] })

    expect(stream.getSnapshot()).toBe(before)
  })

  it('keeps live entries when a delayed history promise resolves later', async () => {
    const stream = new AdminLogStream(10)
    const history = deferred<AdminLogPage>()
    const apply = history.promise.then((page) => stream.applyHistory(page))

    stream.append(entry('2', 2000))
    history.resolve({
      entries: [entry('1', 1000), entry('2', 2000)],
      stream_id: 'stream-a',
      stream_started_at: '2026-11-08T00:00:00.000Z'
    })
    await apply

    expect(ids(stream)).toEqual(['stream-a:2', 'stream-a:1'])
  })

  it('does not let a closed old controller accept delayed history or SSE', async () => {
    const old = new AdminLogStream(10)
    const history = deferred<AdminLogPage>()
    const apply = history.promise.then((page) => old.applyHistory(page))

    const current = new AdminLogStream(10)
    current.append(
      entry('1', 5000, 'stream-b', '2026-11-08T00:01:00.000Z', 'new')
    )

    old.close()
    history.resolve({
      entries: [entry('1', 1000, 'stream-a', '2026-11-08T00:00:00.000Z')],
      stream_id: 'stream-a',
      stream_started_at: '2026-11-08T00:00:00.000Z'
    })
    old.append(entry('2', 2000, 'stream-a'))
    await apply

    expect(ids(current)).toEqual(['stream-b:1'])
    expect(ids(old)).toEqual([])
  })

  it('assigns legacy entries to the current stream when metadata is absent', () => {
    const stream = new AdminLogStream(10)
    stream.applyHistory({
      entries: [
        {
          id: '1',
          timestamp: new Date(BASE).toISOString(),
          level: 'Information',
          source: 'legacy',
          message: 'legacy'
        }
      ],
      stream_id: 'stream-a'
    })

    expect(stream.getSnapshot()[0].stream_id).toBe('stream-a')
  })
})
