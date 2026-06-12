import { describe, expect, it } from 'vitest'

import { normalizeLocatorText } from '@/utils/blockLocator'

describe('block locator', () => {
  it('normalizes mixed punctuation and whitespace', () => {
    expect(normalizeLocatorText('  Human-Computer  Interaction,  ')).toBe('humancomputer interaction')
    expect(normalizeLocatorText('注意时间 = 27.8秒')).toBe('注意时间 278秒')
  })
})
