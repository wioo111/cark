import { describe, expect, it } from 'vitest'

import type { SearchResult } from '@/types'
import {
  applyLocatorToSearchParams,
  buildPaperMemoryItemLocator,
  buildSearchResultLocator,
  parseLocatorFromSearchParams,
} from '@/utils/stableLocator'

describe('stable locator utils', () => {
  it('parses legacy reader search params into a locator object', () => {
    const locator = parseLocatorFromSearchParams(
      new URLSearchParams(
        'view=linearized&annotation=annotation-1&comment=comment-1&memory=memory-1&block=block-7&quote=quoted&before=lead&after=tail',
      ),
    )

    expect(locator).toEqual({
      view: 'linearized',
      annotationId: 'annotation-1',
      commentId: 'comment-1',
      memoryItemId: 'memory-1',
      blockId: 'block-7',
      quote: 'quoted',
      contextBefore: 'lead',
      contextAfter: 'tail',
    })
  })

  it('rewrites query params from a normalized locator', () => {
    const params = new URLSearchParams('annotation=old&quote=stale')
    applyLocatorToSearchParams(params, {
      view: 'bilingual',
      annotationId: 'annotation-2',
      blockId: 'block-3',
    })

    expect(params.toString()).toBe('view=bilingual&annotation=annotation-2&block=block-3')
  })

  it('prefers explicit result locator over legacy search fields', () => {
    const result: SearchResult = {
      id: 'result-3',
      paperId: 'paper-1',
      paperTitle: 'Paper',
      source: 'body',
      sourceLabel: '正文',
      snippet: 'snippet',
      score: 3,
      view: 'linearized',
      matchQuote: 'legacy quote',
      locator: {
        view: 'bilingual',
        blockId: 'block-9',
        quote: 'locator quote',
      },
    }

    expect(buildSearchResultLocator(result)).toEqual({
      view: 'bilingual',
      blockId: 'block-9',
      quote: 'locator quote',
    })
  })

  it('fills missing memory ids on explicit memory search locators', () => {
    const result: SearchResult = {
      id: 'result-memory',
      paperId: 'paper-1',
      paperTitle: 'Paper',
      source: 'memory',
      sourceLabel: '记忆',
      snippet: 'snippet',
      score: 5,
      view: 'linearized',
      annotationId: 'annotation-1',
      memoryItemId: 'memory-1',
      locator: {
        view: 'linearized',
        annotationId: 'annotation-1',
        quote: 'locator quote',
      },
    }

    expect(buildSearchResultLocator(result)).toEqual({
      view: 'linearized',
      annotationId: 'annotation-1',
      memoryItemId: 'memory-1',
      quote: 'locator quote',
    })
  })

  it('builds a memory locator from legacy anchor fields', () => {
    expect(
      buildPaperMemoryItemLocator({
        id: 'memory-2',
        paperId: 'paper-1',
        type: 'note',
        text: 'A note',
        content: 'A note',
        sourceAnnotationId: 'annotation-8',
        locator: null,
        anchor: {
          view: 'linearized',
          contextBefore: 'before text',
          contextAfter: 'after text',
        },
        createdAt: '2026-06-19T00:00:00',
        updatedAt: '2026-06-19T00:00:00',
        blockId: 'block-11',
        blockPreview: null,
        quote: 'quoted line',
        tags: [],
        status: 'active',
      }),
    ).toEqual({
      view: 'linearized',
      annotationId: 'annotation-8',
      memoryItemId: 'memory-2',
      blockId: 'block-11',
      quote: 'quoted line',
      contextBefore: 'before text',
      contextAfter: 'after text',
    })
  })
})
