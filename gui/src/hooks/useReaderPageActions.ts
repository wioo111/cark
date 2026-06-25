import type { SelectionToolbarState } from '@/utils/readerSelection'
import { clearBrowserSelection, readSelection } from '@/utils/readerSelection'
import { scrollToArticleSection } from '@/utils/markdown'
import type { PaperBlock, PaperView } from '@/types'

interface UseReaderPageActionsArgs {
  articleRef: React.RefObject<HTMLDivElement | null>
  articleShellRef: React.RefObject<HTMLDivElement | null>
  activeView: PaperView
  blocks: PaperBlock[]
  toolbarSelection: SelectionToolbarState | null
  setSearchParams: (
    nextInit:
      | URLSearchParams
      | ((prev: URLSearchParams) => URLSearchParams),
    navigateOptions?: { replace?: boolean },
  ) => void
  setToolbarSelection: React.Dispatch<React.SetStateAction<SelectionToolbarState | null>>
  setOutlineOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveSectionId: React.Dispatch<React.SetStateAction<string | null>>
  setReadingStateError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useReaderPageActions({
  articleRef,
  articleShellRef,
  activeView,
  blocks,
  toolbarSelection,
  setSearchParams,
  setToolbarSelection,
  setOutlineOpen,
  setActiveSectionId,
  setReadingStateError,
}: UseReaderPageActionsArgs) {
  function setView(view: PaperView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('view', view)
      return next
    })
  }

  function jumpToHeading(id: string) {
    setOutlineOpen(false)
    window.requestAnimationFrame(() => {
      const container = articleRef.current
      if (!container || !scrollToArticleSection(container, id)) {
        setReadingStateError('目录定位失败，请刷新页面后重试')
        return
      }
      setActiveSectionId(id)
    })
  }

  function handleSelectionCapture() {
    const nextSelection = readSelection(articleRef.current, articleShellRef.current, activeView, blocks)
    setToolbarSelection(nextSelection)
  }

  async function handleCopySelection() {
    if (!toolbarSelection) {
      return
    }
    await navigator.clipboard.writeText(toolbarSelection.quote)
    clearBrowserSelection()
    setToolbarSelection(null)
  }

  function handleSearchSelection() {
    if (!toolbarSelection) {
      return
    }
    window.open(`https://www.google.com/search?q=${encodeURIComponent(toolbarSelection.quote)}`, '_blank', 'noopener,noreferrer')
    clearBrowserSelection()
    setToolbarSelection(null)
  }

  return {
    setView,
    jumpToHeading,
    handleSelectionCapture,
    handleCopySelection,
    handleSearchSelection,
  }
}
