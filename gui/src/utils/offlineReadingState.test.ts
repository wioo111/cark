// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { preferNewestReadingState, readOfflineReadingState, saveOfflineReadingState } from '@/utils/offlineReadingState'

describe('offline reading state', () => {
  beforeEach(() => window.localStorage.clear())

  it('stores reading progress on the device', () => {
    saveOfflineReadingState('paper-1', {
      view: 'bilingual',
      scrollY: 420,
      clientRevision: 7,
      activeSectionId: 'section-3',
    })

    expect(readOfflineReadingState('paper-1')).toMatchObject({
      paperId: 'paper-1',
      view: 'bilingual',
      scrollY: 420,
      clientRevision: 7,
    })
  })

  it('prefers the newest device progress over an older server copy', () => {
    const server = { paperId: 'paper-1', view: 'linearized' as const, scrollY: 10, clientRevision: 4 }
    const local = { paperId: 'paper-1', view: 'bilingual' as const, scrollY: 50, clientRevision: 5 }
    expect(preferNewestReadingState(server, local)).toBe(local)
  })
})
