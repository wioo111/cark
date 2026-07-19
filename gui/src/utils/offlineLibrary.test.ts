// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadPaperForOffline, isPaperOffline, updateOfflinePaperSummary } from '@/utils/offlineLibrary'
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

  it('updates favorites and reading status without contacting the computer', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cached = new Response(JSON.stringify([{ id: 'paper-1', title: 'Paper One', favorite: false }]))
    const put = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(cached), put }) },
    })

    const updated = await updateOfflinePaperSummary('paper-1', { favorite: true, readingStatus: 'reading' })

    expect(updated).toMatchObject({ favorite: true, readingStatus: 'reading' })
    expect(put).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
