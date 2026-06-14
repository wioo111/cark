import { describe, expect, it } from 'vitest'

import type { PaperSummary } from '@/types'
import {
  cleanBilingualMarkdown,
  extractBilingualOutline,
  extractOutline,
  getPreferredView,
  matchesQuery,
  resolvePaperView,
} from '@/utils/paper'

describe('paper utils', () => {
  it('extracts heading outline from markdown', () => {
    const markdown = '# 标题\n\n正文\n\n## 第二节\n\n### 细节'
    expect(extractOutline(markdown)).toEqual([
      { id: 'section-1', level: 1, text: '标题' },
      { id: 'section-2', level: 2, text: '第二节' },
      { id: 'section-3', level: 3, text: '细节' },
    ])
  })

  it('uses only original headings in bilingual navigation', () => {
    const original = '## ABSTRACT\n\n## 1. INTRODUCTION\n\n## 1. INTRODUCTION\n\n## 1.1. Results'
    const bilingual = [
      '## ABSTRACT',
      '## 摘要',
      '## 1. INTRODUCTION',
      '## 1. 引言',
      '## 1. INTRODUCTION',
      '## 1. 引言',
      '# Original Heading',
      '# Translated Heading',
      '## 1.1. Results',
      '## 1.1. 结果',
    ].join('\n\n')

    expect(extractBilingualOutline(original, cleanBilingualMarkdown(bilingual))).toEqual([
      { id: 'section-1', level: 2, text: 'ABSTRACT' },
      { id: 'section-3', level: 2, text: '1. INTRODUCTION' },
      { id: 'section-7', level: 2, text: '1.1. Results' },
    ])
    expect(cleanBilingualMarkdown(bilingual)).not.toContain('Original Heading')
  })

  it('returns preferred view in priority order', () => {
    expect(getPreferredView(['linearized', 'bilingual'])).toBe('bilingual')
    expect(getPreferredView(['linearized'])).toBe('linearized')
  })

  it('resolves requested view before restored and default views', () => {
    const views = ['linearized', 'bilingual'] as const
    expect(resolvePaperView([...views], 'linearized', 'bilingual')).toBe('linearized')
    expect(resolvePaperView([...views], null, 'linearized')).toBe('linearized')
    expect(resolvePaperView(['linearized'], 'bilingual', 'bilingual')).toBe('linearized')
  })

  it('matches title and source pdf keywords', () => {
    const paper: PaperSummary = {
      id: 'a',
      title: 'As We May Think',
      taskId: '20260610',
      updatedAt: '2026-06-10T10:00:00',
      availableViews: ['linearized'],
      hasImages: false,
      sourcePdf: 'CLASSIC_1945_As We May Think.pdf',
    }

    expect(matchesQuery(paper, 'think')).toBe(true)
    expect(matchesQuery(paper, 'classic_1945')).toBe(true)
    expect(matchesQuery(paper, 'foobar')).toBe(false)
  })
})
