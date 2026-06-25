// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import type { MockedFunction } from 'vitest'
import { describe, expect, it, vi } from 'vitest'

import { useReaderRouteSync } from '@/hooks/useReaderRouteSync'
import type { PaperAnnotation, StableLocator } from '@/types'
import { buildLocatorSearchParams } from '@/utils/stableLocator'

vi.mock('@/utils/stableLocator', () => ({
  buildLocatorSearchParams: vi.fn(() => new URLSearchParams('view=bilingual&annotationId=annotation-1')),
}))

type SearchParamsSetter = (
  nextInit: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
  navigateOptions?: { replace?: boolean },
) => void

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>

function makeAnnotation(overrides: Partial<PaperAnnotation> = {}): PaperAnnotation {
  return {
    id: 'annotation-1',
    paperId: 'paper-1',
    view: 'bilingual',
    quote: 'Quoted text',
    contextBefore: null,
    contextAfter: null,
    anchorTop: 0,
    anchorHeight: 20,
    createdAt: '2026-06-20T00:00:00',
    updatedAt: '2026-06-20T00:00:00',
    archived: false,
    archivedAt: null,
    comments: [],
    ...overrides,
  }
}

function Harness({
  annotations = [makeAnnotation()],
  activeView = 'linearized',
  requestedAnnotationId = 'annotation-1',
  requestedMemoryItemId = null,
  requestedLocator = { annotationId: 'annotation-1', view: 'linearized' },
  setSearchParams = vi.fn(),
  setFocusedAnnotationId = vi.fn(),
  setMemoryOpen = vi.fn(),
}: {
  annotations?: PaperAnnotation[]
  activeView?: string
  requestedAnnotationId?: string | null
  requestedMemoryItemId?: string | null
  requestedLocator?: StableLocator | null
  setSearchParams?: SearchParamsSetter
  setFocusedAnnotationId?: StateSetter<string | null>
  setMemoryOpen?: StateSetter<boolean>
}) {
  useReaderRouteSync({
    annotations,
    activeView,
    requestedAnnotationId,
    requestedMemoryItemId,
    requestedLocator,
    setSearchParams,
    setFocusedAnnotationId,
    setMemoryOpen,
  })

  return null
}

describe('useReaderRouteSync', () => {
  it('switches the route view when the requested annotation belongs to another view', async () => {
    const setSearchParams: MockedFunction<SearchParamsSetter> = vi.fn()
    const setFocusedAnnotationId: MockedFunction<StateSetter<string | null>> = vi.fn()

    render(
      <Harness
        setSearchParams={setSearchParams}
        setFocusedAnnotationId={setFocusedAnnotationId}
      />,
    )

    await waitFor(() => {
      expect(buildLocatorSearchParams).toHaveBeenCalledWith({
        annotationId: 'annotation-1',
        view: 'bilingual',
      })
      expect(setSearchParams).toHaveBeenCalled()
    })

    const [nextSearchParams, navigateOptions] = setSearchParams.mock.calls[0]
    expect((nextSearchParams as URLSearchParams).toString()).toBe('view=bilingual&annotationId=annotation-1')
    expect(navigateOptions).toEqual({ replace: true })

    expect(setFocusedAnnotationId).not.toHaveBeenCalled()
  })

  it('focuses the annotation and opens memory when the route is already aligned', async () => {
    const setFocusedAnnotationId: MockedFunction<StateSetter<string | null>> = vi.fn()
    const setMemoryOpen: MockedFunction<StateSetter<boolean>> = vi.fn()

    render(
      <Harness
        activeView="bilingual"
        requestedMemoryItemId="memory-1"
        setFocusedAnnotationId={setFocusedAnnotationId}
        setMemoryOpen={setMemoryOpen}
      />,
    )

    await waitFor(() => {
      expect(setFocusedAnnotationId).toHaveBeenCalledWith('annotation-1')
      expect(setMemoryOpen).toHaveBeenCalledWith(true)
    })
  })
})
