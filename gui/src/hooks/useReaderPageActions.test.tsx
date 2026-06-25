// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MockedFunction } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReaderPageActions } from '@/hooks/useReaderPageActions'
import type { PaperBlock } from '@/types'
import { scrollToArticleSection } from '@/utils/markdown'
import { clearBrowserSelection, readSelection, type SelectionToolbarState } from '@/utils/readerSelection'

vi.mock('@/utils/markdown', () => ({
  scrollToArticleSection: vi.fn(),
}))

vi.mock('@/utils/readerSelection', () => ({
  clearBrowserSelection: vi.fn(),
  readSelection: vi.fn(),
}))

type SearchParamsSetter = (
  nextInit: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
  navigateOptions?: { replace?: boolean },
) => void

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>

const blocks: PaperBlock[] = [
  {
    id: 'block-1',
    index: 0,
    type: 'paragraph',
    pageIdx: 0,
    preview: 'Preview text',
  },
]

const toolbarSelection: SelectionToolbarState = {
  quote: 'selected text',
  contextBefore: 'before',
  contextAfter: 'after',
  blockId: 'block-1',
  anchorTop: 120,
  anchorHeight: 24,
  view: 'linearized',
  toolbarX: 12,
  toolbarY: 24,
}

function Harness({
  currentSelection = toolbarSelection,
  setSearchParams = vi.fn(),
  setToolbarSelection = vi.fn(),
  setOutlineOpen = vi.fn(),
  setActiveSectionId = vi.fn(),
  setReadingStateError = vi.fn(),
}: {
  currentSelection?: SelectionToolbarState | null
  setSearchParams?: SearchParamsSetter
  setToolbarSelection?: StateSetter<SelectionToolbarState | null>
  setOutlineOpen?: StateSetter<boolean>
  setActiveSectionId?: StateSetter<string | null>
  setReadingStateError?: StateSetter<string | null>
}) {
  const articleRef = { current: document.createElement('div') }
  const articleShellRef = { current: document.createElement('div') }
  const { setView, jumpToHeading, handleSelectionCapture, handleCopySelection, handleSearchSelection } = useReaderPageActions({
    articleRef,
    articleShellRef,
    activeView: 'linearized',
    blocks,
    toolbarSelection: currentSelection,
    setSearchParams,
    setToolbarSelection,
    setOutlineOpen,
    setActiveSectionId,
    setReadingStateError,
  })

  return (
    <div>
      <button type="button" onClick={() => setView('bilingual')}>
        Set View
      </button>
      <button type="button" onClick={() => jumpToHeading('heading-1')}>
        Jump
      </button>
      <button type="button" onClick={handleSelectionCapture}>
        Capture
      </button>
      <button type="button" onClick={() => void handleCopySelection()}>
        Copy
      </button>
      <button type="button" onClick={handleSearchSelection}>
        Search
      </button>
    </div>
  )
}

describe('useReaderPageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('updates the route view and captures selection data', () => {
    const setSearchParams: MockedFunction<SearchParamsSetter> = vi.fn()
    const setToolbarSelection: MockedFunction<StateSetter<SelectionToolbarState | null>> = vi.fn()
    vi.mocked(readSelection).mockReturnValue(toolbarSelection)

    render(
      <Harness
        setSearchParams={setSearchParams}
        setToolbarSelection={setToolbarSelection}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set View' }))
    const updateSearchParams = setSearchParams.mock.calls[0][0] as (current: URLSearchParams) => URLSearchParams
    expect(updateSearchParams(new URLSearchParams('foo=bar')).toString()).toBe('foo=bar&view=bilingual')

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    expect(readSelection).toHaveBeenCalled()
    expect(setToolbarSelection).toHaveBeenCalledWith(toolbarSelection)
  })

  it('jumps to headings and reports a readable error when section lookup fails', async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      })
    const setOutlineOpen: MockedFunction<StateSetter<boolean>> = vi.fn()
    const setActiveSectionId: MockedFunction<StateSetter<string | null>> = vi.fn()
    const setReadingStateError: MockedFunction<StateSetter<string | null>> = vi.fn()

    vi.mocked(scrollToArticleSection).mockReturnValueOnce(true).mockReturnValueOnce(false)

    render(
      <Harness
        setOutlineOpen={setOutlineOpen}
        setActiveSectionId={setActiveSectionId}
        setReadingStateError={setReadingStateError}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Jump' }))
    await waitFor(() => {
      expect(setOutlineOpen).toHaveBeenCalledWith(false)
      expect(setActiveSectionId).toHaveBeenCalledWith('heading-1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Jump' }))
    await waitFor(() => {
      expect(setReadingStateError).toHaveBeenCalledWith('目录定位失败，请刷新页面后重试')
    })

    requestAnimationFrameSpy.mockRestore()
  })

  it('copies and searches the current selection, then clears browser selection state', async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    const setToolbarSelection: MockedFunction<StateSetter<SelectionToolbarState | null>> = vi.fn()

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    })

    render(
      <Harness
        currentSelection={toolbarSelection}
        setToolbarSelection={setToolbarSelection}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('selected text')
      expect(clearBrowserSelection).toHaveBeenCalled()
      expect(setToolbarSelection).toHaveBeenCalledWith(null)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(windowOpen).toHaveBeenCalledWith(
      'https://www.google.com/search?q=selected%20text',
      '_blank',
      'noopener,noreferrer',
    )
    expect(setToolbarSelection).toHaveBeenCalledWith(null)

    windowOpen.mockRestore()
  })
})
