import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveReadingState } from '@/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading state api', () => {
  it('uses fetch keepalive for final page-exit saves', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paperId: 'paper-1',
        view: 'linearized',
        scrollY: 42,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await saveReadingState(
      'paper-1',
      {
        view: 'linearized',
        scrollY: 42,
        activeSectionId: 'section-2',
        draft: null,
      },
      { keepalive: true },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/reading-state',
      expect.objectContaining({
        method: 'PUT',
        keepalive: true,
      }),
    )
  })
})
