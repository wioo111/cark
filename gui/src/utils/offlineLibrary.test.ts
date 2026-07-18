// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadPaperForOffline, isPaperOffline } from '@/utils/offlineLibrary'
import type { PaperDetail } from '@/types'

describe('offline paper library', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('downloads paper data and referenced images into the device cache', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { open: vi.fn().mockResolvedValue({ put }) },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const detail = {
      id: 'paper-1',
      title: 'Paper One',
      images: [],
      markdown: { linearized: '![figure](images/figure.png)' },
    } as unknown as PaperDetail

    const result = await downloadPaperForOffline(detail)

    expect(result.total).toBe(5)
    expect(isPaperOffline('paper-1')).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/papers', { credentials: 'same-origin' })
    expect(fetch).toHaveBeenCalledWith('/api/media/paper-1?path=auto%2Fimages%2Ffigure.png', { credentials: 'same-origin' })
    vi.unstubAllGlobals()
  })
})
