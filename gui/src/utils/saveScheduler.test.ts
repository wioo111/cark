import { describe, expect, it, vi } from 'vitest'

import { createSaveScheduler } from '@/utils/saveScheduler'

describe('save scheduler', () => {
  it('debounces normal saves', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createSaveScheduler(save)

    scheduler.schedule(300)
    scheduler.schedule(300)
    await vi.advanceTimersByTimeAsync(299)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(false)
    vi.useRealTimers()
  })

  it('flushes the pending save with keepalive on dispose', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createSaveScheduler(save)

    scheduler.schedule(350)
    await scheduler.dispose()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
