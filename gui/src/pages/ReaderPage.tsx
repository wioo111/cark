import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { postOpenAction } from '@/api'
import { CommentLane } from '@/components/CommentLane'
import { MarkdownArticle } from '@/components/MarkdownArticle'
import type { MemoryNoteSeed } from '@/components/PaperMemoryPanel'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { useReaderAnnotationActions } from '@/hooks/useReaderAnnotationActions'
import { useReaderDocumentState } from '@/hooks/useReaderDocumentState'
import { useReaderLocatorEffects } from '@/hooks/useReaderLocatorEffects'
import { useReaderPageActions } from '@/hooks/useReaderPageActions'
import { useReaderReadingProgress } from '@/hooks/useReaderReadingProgress'
import { useReaderRouteSync } from '@/hooks/useReaderRouteSync'
import { useCopilotRuns } from '@/hooks/useCopilotRuns'
import {
  ReaderFloatingActions,
  ReaderHeader,
  ReaderHighlightLayer,
  ReaderOutlineSheet,
  ReaderPageError,
  ReaderPageLoading,
  ReaderStatusToasts,
} from '@/pages/ReaderPage.parts'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type {
  PaperAnnotation,
} from '@/types'
import { cleanBilingualMarkdown, extractBilingualOutline, extractOutline, resolvePaperView } from '@/utils/paper'
import {
  buildLocatorSearchParams,
  buildPaperMemoryItemLocator,
  parseLocatorFromSearchParams,
} from '@/utils/stableLocator'
import type { SelectionToolbarState } from '@/utils/readerSelection'

const PaperMemoryPanel = lazy(async () => {
  const module = await import('@/components/PaperMemoryPanel')
  return { default: module.PaperMemoryPanel }
})

export default function ReaderPage() {
  const { paperId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const rememberPaper = useWorkspaceStore((state) => state.rememberPaper)
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [readingStateError, setReadingStateError] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [laneHeight, setLaneHeight] = useState(0)
  const [toolbarSelection, setToolbarSelection] = useState<SelectionToolbarState | null>(null)
  const [positionedAnnotations, setPositionedAnnotations] = useState<PaperAnnotation[]>([])
  const [annotationHighlights, setAnnotationHighlights] = useState<
    Array<{ annotationId: string; rects: Array<{ top: number; left: number; width: number; height: number }> }>
  >([])
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null)
  const [flashAnnotationId, setFlashAnnotationId] = useState<string | null>(null)
  const [searchHighlightRects, setSearchHighlightRects] = useState<
    Array<{ top: number; left: number; width: number; height: number }>
  >([])
  const [searchHighlightTop, setSearchHighlightTop] = useState<number | null>(null)
  const [searchHighlightHeight, setSearchHighlightHeight] = useState<number | null>(null)
  const [flashSearchHighlight, setFlashSearchHighlight] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memorySeed, setMemorySeed] = useState<MemoryNoteSeed | null>(null)
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const articleShellRef = useRef<HTMLDivElement | null>(null)
  const articleRef = useRef<HTMLDivElement | null>(null)

  const {
    detail,
    annotations,
    setAnnotations,
    loading,
    error,
    settings,
    restoredView,
    restoredDraft,
    readingStateLoaded,
    restoredScrollY,
  } = useReaderDocumentState({
    paperId,
    rememberPaper,
    setAnnotationError,
    setReadingStateError,
  })

  const requestedLocator = useMemo(() => parseLocatorFromSearchParams(searchParams), [searchParams])
  const requestedView = requestedLocator?.view ?? null
  const requestedAnnotationId = requestedLocator?.annotationId ?? null
  const requestedCommentId = requestedLocator?.commentId ?? null
  const requestedMemoryItemId = requestedLocator?.memoryItemId ?? null
  const requestedBlockId = requestedLocator?.blockId ?? null
  const requestedBodyQuote = requestedLocator?.quote ?? null
  const requestedBodyContextBefore = requestedLocator?.contextBefore ?? null
  const requestedBodyContextAfter = requestedLocator?.contextAfter ?? null
  const activeView = useMemo(
    () => resolvePaperView(detail?.availableViews ?? ['linearized'], requestedView, restoredView),
    [detail?.availableViews, requestedView, restoredView],
  )
  const availableAgents = useMemo(
    () =>
      settings.copilot.agents.filter(
        (agent) =>
          agent.enabled &&
          agent.name.trim() &&
          agent.rolePrompt.trim() &&
          agent.apiKey.trim() &&
          agent.baseUrl.trim() &&
          agent.model.trim(),
      ),
    [settings.copilot.agents],
  )
  const {
    copilotRuns,
    activeAgentAnnotationIds,
    startCopilotRun,
    cancelCopilotRun,
    retryCopilotRun,
  } = useCopilotRuns({
    paperId: detail?.id ?? paperId,
    onAnnotationsRefreshed: setAnnotations,
  })
  const {
    draft,
    setDraft,
    savingDraft,
    replyDraft,
    setReplyDraft,
    savingReply,
    editDraft,
    setEditDraft,
    savingEdit,
    memorySavingAnnotationIds,
    memorySavedAnnotationIds,
    memorySavingAgentCommentIds,
    memorySavedAgentCommentIds,
    memoryNotice,
    handleDraftStart,
    handleDraftSubmit,
    handleReplyStart,
    handleReplySubmit,
    handleDraftAgentToggle,
    handleReplyAgentToggle,
    handleEditStart,
    handleEditSubmit,
    handleArchiveToggle,
    handleDeleteAnnotation,
    handleCreateMemoryFromAnnotation,
    handleCreateMemoryFromAgentComment,
    handleSelectionAgentAction,
    handleCancelCopilotRun,
    handleRetryCopilotRun,
  } = useReaderAnnotationActions({
    detail,
    annotations,
    toolbarSelection,
    setAnnotations,
    setToolbarSelection,
    setAnnotationError,
    setFocusedAnnotationId,
    setMemoryOpen,
    setMemoryRefreshKey,
    agentIdsForQuickActions: availableAgents.map((agent) => agent.id),
    startCopilotRun,
    cancelCopilotRun,
    retryCopilotRun,
  })

  const markdown = useMemo(() => {
    const source = detail?.markdown[activeView] ?? ''
    return activeView === 'bilingual' ? cleanBilingualMarkdown(source) : source
  }, [activeView, detail?.markdown])
  const outline = useMemo(() => {
    if (activeView === 'bilingual') {
      return extractBilingualOutline(detail?.markdown.linearized ?? '', markdown)
    }
    return extractOutline(markdown)
  }, [activeView, detail?.markdown.linearized, markdown])

  useEffect(() => {
    setDraft(restoredDraft)
  }, [restoredDraft, setDraft])

  useReaderReadingProgress({
    detail,
    loading,
    readingStateLoaded,
    activeView,
    activeSectionId,
    draft,
    markdown,
    restoredScrollY,
    setReadingStateError,
  })

  useReaderLocatorEffects({
    articleRef,
    articleShellRef,
    outline,
    markdown,
    annotations,
    positionedAnnotations,
    activeView,
    detail,
    draft,
    focusedAnnotationId,
    requestedBlockId,
    requestedAnnotationId,
    requestedBodyQuote,
    requestedBodyContextBefore,
    requestedBodyContextAfter,
    searchHighlightTop,
    onActiveSectionIdChange: setActiveSectionId,
    onLaneHeightChange: setLaneHeight,
    onPositionedAnnotationsChange: setPositionedAnnotations,
    onAnnotationHighlightsChange: setAnnotationHighlights,
    onSearchHighlightRectsChange: setSearchHighlightRects,
    onSearchHighlightTopChange: setSearchHighlightTop,
    onSearchHighlightHeightChange: setSearchHighlightHeight,
    onFlashAnnotationIdChange: setFlashAnnotationId,
    onFlashSearchHighlightChange: setFlashSearchHighlight,
    onToolbarSelectionChange: setToolbarSelection,
  })

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

  const {
    setView,
    jumpToHeading,
    handleSelectionCapture,
    handleCopySelection,
    handleSearchSelection,
  } = useReaderPageActions({
    articleRef,
    articleShellRef,
    activeView,
    blocks: detail?.blocks ?? [],
    toolbarSelection,
    setSearchParams,
    setToolbarSelection,
    setOutlineOpen,
    setActiveSectionId,
    setReadingStateError,
  })

  if (loading) {
    return <ReaderPageLoading />
  }

  if (!detail || error) {
    return <ReaderPageError error={error || '未找到该论文'} />
  }

  return (
    <main className="cark-page min-h-screen">
      <ReaderFloatingActions onOpenOutline={() => setOutlineOpen(true)} />
      <ReaderStatusToasts
        annotationError={annotationError}
        readingStateError={readingStateError}
        memoryNotice={memoryNotice}
        onClearErrors={() => {
          setAnnotationError(null)
          setReadingStateError(null)
        }}
      />
      <ReaderOutlineSheet
        open={outlineOpen}
        outline={outline}
        activeSectionId={activeSectionId}
        onClose={() => setOutlineOpen(false)}
        onJump={jumpToHeading}
      />

      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-6 py-6 lg:px-8">
        <ReaderHeader
          detail={detail}
          activeView={activeView}
          onOpenRootDir={() => void postOpenAction(detail.id, 'rootDir')}
          onOpenMemory={() => setMemoryOpen(true)}
          onSetView={setView}
        />

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={articleShellRef} className="cark-panel relative overflow-hidden rounded-[28px]">
            <div className="border-b px-6 py-4 [border-color:var(--border-soft)]">
              <p className="cark-faint text-xs uppercase tracking-[0.22em]">正文视图</p>
              <h2 className="cark-title mt-1 font-serif text-xl">
                {activeView === 'bilingual' ? '译文版本' : '原文'}
              </h2>
            </div>
            <ReaderHighlightLayer
              searchHighlightRects={searchHighlightRects}
              searchHighlightTop={searchHighlightTop}
              searchHighlightHeight={searchHighlightHeight}
              flashSearchHighlight={flashSearchHighlight}
              articleShellWidth={articleShellRef.current?.clientWidth ?? 96}
              annotationHighlights={annotationHighlights}
              positionedAnnotations={positionedAnnotations}
              activeView={activeView}
              flashAnnotationId={flashAnnotationId}
            />
            <div
              ref={articleRef}
              className="relative px-5 py-6 lg:px-8"
              onMouseUp={handleSelectionCapture}
              onKeyUp={handleSelectionCapture}
            >
              <div className="cark-paper rounded-[30px] px-6 py-8 lg:px-10 lg:py-10">
                <MarkdownArticle markdown={markdown} paperId={detail.id} />
              </div>
            </div>
          </div>

          <CommentLane
            annotations={positionedAnnotations}
            activeView={activeView}
            focusCommentId={requestedCommentId}
            laneHeight={laneHeight}
            agents={availableAgents}
            activeAgentAnnotationIds={activeAgentAnnotationIds}
            copilotRuns={copilotRuns}
            memorySavingAnnotationIds={memorySavingAnnotationIds}
            memorySavedAnnotationIds={memorySavedAnnotationIds}
            memorySavingAgentCommentIds={memorySavingAgentCommentIds}
            memorySavedAgentCommentIds={memorySavedAgentCommentIds}
            draft={draft}
            savingDraft={savingDraft}
            replyDraft={replyDraft}
            savingReply={savingReply}
            editDraft={editDraft}
            savingEdit={savingEdit}
            onDraftChange={(value) => setDraft((current) => (current ? { ...current, content: value } : current))}
            onDraftCancel={() => setDraft(null)}
            onDraftSubmit={() => void handleDraftSubmit()}
            onDraftAgentToggle={handleDraftAgentToggle}
            onSelectAnnotation={(annotationId) => setFocusedAnnotationId(annotationId)}
            onReplyStart={handleReplyStart}
            onReplyChange={(value) => setReplyDraft((current) => (current ? { ...current, content: value } : current))}
            onReplyCancel={() => setReplyDraft(null)}
            onReplySubmit={() => void handleReplySubmit()}
            onReplyAgentToggle={handleReplyAgentToggle}
            onCancelCopilotRun={(runId) => void handleCancelCopilotRun(runId)}
            onRetryCopilotRun={(runId, agentId) => void handleRetryCopilotRun(runId, agentId)}
            onEditStart={(annotationId, comment) => handleEditStart(annotationId, comment.id, comment.content)}
            onEditChange={(value) => setEditDraft((current) => (current ? { ...current, content: value } : current))}
            onEditCancel={() => setEditDraft(null)}
            onEditSubmit={() => void handleEditSubmit()}
            onArchiveToggle={(annotationId, nextArchived) => void handleArchiveToggle(annotationId, nextArchived)}
            onDeleteAnnotation={(annotationId) => void handleDeleteAnnotation(annotationId)}
            onCreateMemoryFromAnnotation={(annotation) => void handleCreateMemoryFromAnnotation(annotation)}
            onCreateMemoryFromAgentComment={(annotation, comment) =>
              void handleCreateMemoryFromAgentComment(annotation, comment)
            }
          />
        </section>
      </div>

      {toolbarSelection ? (
        <SelectionToolbar
          x={toolbarSelection.toolbarX}
          y={toolbarSelection.toolbarY}
          onCopy={() => void handleCopySelection()}
          onSearch={handleSearchSelection}
          onComment={handleDraftStart}
          onExplain={() => void handleSelectionAgentAction('explain')}
          onCritique={() => void handleSelectionAgentAction('critique')}
          onMemoryCandidate={() => void handleSelectionAgentAction('memory_candidate')}
          agentActionsDisabled={availableAgents.length === 0}
        />
      ) : null}

      {memoryOpen ? (
        <Suspense fallback={null}>
          <PaperMemoryPanel
            open={memoryOpen}
            paperId={detail.id}
            paperTitle={detail.title}
            seed={memorySeed}
            focusItemId={requestedMemoryItemId}
            refreshKey={memoryRefreshKey}
            onClose={() => setMemoryOpen(false)}
            onSeedConsumed={() => setMemorySeed(null)}
            onLocateItem={(item) => {
              setMemoryOpen(false)
              setSearchParams(buildLocatorSearchParams(buildPaperMemoryItemLocator(item)))
            }}
          />
        </Suspense>
      ) : null}
    </main>
  )
}
