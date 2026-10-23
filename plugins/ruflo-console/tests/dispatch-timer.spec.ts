import { afterEach, describe, expect, it, vi } from 'vitest'

import { settleWithin } from '../hooks/dispatch'

describe('settleWithin', () => {
  afterEach(() => vi.useRealTimers())

  it('leaves no timer pending after a fast probe', async () => {
    vi.useFakeTimers()
    await settleWithin(Promise.resolve('fast'), 8_000)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer pending after a probe that rejects, and passes the rejection on', async () => {
    vi.useFakeTimers()
    await expect(settleWithin(Promise.reject(new Error('x')), 8_000)).rejects.toThrow('x')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('still gives up on a probe that never settles once the wait is over', async () => {
    vi.useFakeTimers()

    let isDone = false
    const waiting = settleWithin(new Promise(() => undefined), 8_000).then(() => { isDone = true })

    await vi.advanceTimersByTimeAsync(7_999)
    expect(isDone).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(isDone).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
