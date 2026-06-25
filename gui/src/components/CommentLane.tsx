import { useEffect, useMemo, useRef, useState } from 'react'

import type { PaperAnnotation } from '@/types'

import {
  ArchivedThreadsDock,
  CommentDraftCard,
  CommentThreadCard,
  QuoteDetailOverlay,
  ThreadDetailOverlay,
} from './CommentLane.parts'
import type { CommentLaneProps } from './CommentLane.types'
import {
  areMeasuredHeightsEqual,
  draftMeasurementKey,
  estimateCardHeight,
  estimateDraftHeight,
} from './CommentLane.utils'

export type {
  AnnotationComposerDraft,
  AnnotationEditDraft,
  AnnotationReplyDraft,
  AnnotationReplyTarget,
} from './CommentLane.types'

export function CommentLane({
  annotations,
  activeView,
  focusCommentId,
  laneHeight,
  agents,
  activeAgentAnnotationIds,
  copilotRuns,
  memorySavingAnnotationIds,
  memorySavedAnnotationIds,
  draft,
  savingDraft,
  replyDraft,
  savingReply,
  editDraft,
  savingEdit,
  onDraftChange,
  onDraftCancel,
  onDraftSubmit,
  onDraftAgentToggle,
  onSelectAnnotation,
  onReplyStart,
  onReplyChange,
  onReplyCancel,
  onReplySubmit,
  onReplyAgentToggle,
  onCancelCopilotRun,
  onRetryCopilotRun,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditSubmit,
  onArchiveToggle,
  onDeleteAnnotation,
  onCreateMemoryFromAnnotation,
}: CommentLaneProps) {
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [quoteDetailAnnotation, setQuoteDetailAnnotation] = useState<PaperAnnotation | null>(null)
  const [threadDetailAnnotation, setThreadDetailAnnotation] = useState<PaperAnnotation | null>(null)
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const laneRef = useRef<HTMLDivElement | null>(null)
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.view === activeView && !annotation.archived),
    [activeView, annotations],
  )
  const archivedAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.view === activeView && annotation.archived),
    [activeView, annotations],
  )
  const placements = useMemo(() => {
    let previousBottom = 0
    return visibleAnnotations.map((annotation) => {
      const reservedHeight = measuredHeights[annotation.id] ?? estimateCardHeight(annotation)
      const top = Math.max(annotation.anchorTop, previousBottom + 16)
      previousBottom = top + reservedHeight
      return { annotation, top, reservedHeight }
    })
  }, [measuredHeights, visibleAnnotations])

  useEffect(() => {
    setMeasuredHeights((current) => {
      const nextEntries = Object.entries(current).filter(([id]) =>
        visibleAnnotations.some((annotation) => annotation.id === id),
      )
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }
      return Object.fromEntries(nextEntries)
    })
  }, [visibleAnnotations])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const lane = laneRef.current
      if (!lane) {
        return
      }
      const nextHeights: Record<string, number> = {}
      lane.querySelectorAll<HTMLElement>('[data-measure-key]').forEach((element) => {
        const key = element.dataset.measureKey
        if (!key) {
          return
        }
        nextHeights[key] = Math.ceil(element.getBoundingClientRect().height)
      })
      setMeasuredHeights((current) => (areMeasuredHeightsEqual(current, nextHeights) ? current : nextHeights))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [annotations, draft, editDraft, laneHeight, replyDraft, threadDetailAnnotation])

  const draftTop = useMemo(() => {
    if (!draft) {
      return null
    }
    const draftHeight = measuredHeights[draftMeasurementKey] ?? estimateDraftHeight(draft)
    let top = draft.anchorTop
    for (const placement of placements) {
      const placementBottom = placement.top + placement.reservedHeight
      const overlaps = top < placementBottom + 16 && top + draftHeight > placement.top - 16
      if (overlaps) {
        top = placementBottom + 16
      }
    }
    return top
  }, [draft, measuredHeights, placements])

  useEffect(() => {
    if (archivedAnnotations.length > 0) {
      setArchivedOpen(true)
    }
  }, [archivedAnnotations.length])

  useEffect(() => {
    if (!focusCommentId) {
      return
    }
    const targetAnnotation = annotations.find(
      (annotation) =>
        annotation.view === activeView && annotation.comments.some((comment) => comment.id === focusCommentId),
    )
    if (targetAnnotation) {
      setThreadDetailAnnotation(targetAnnotation)
    }
  }, [activeView, annotations, focusCommentId])

  return (
    <aside className="relative">
      <div ref={laneRef} className="relative" style={{ minHeight: `${Math.max(laneHeight, 200)}px` }}>
        {placements.map(({ annotation, top }) => (
          <CommentThreadCard
            key={annotation.id}
            annotation={annotation}
            top={top}
            agents={agents}
            activeAgentAnnotationIds={activeAgentAnnotationIds}
            copilotRuns={copilotRuns}
            memorySavingAnnotationIds={memorySavingAnnotationIds}
            memorySavedAnnotationIds={memorySavedAnnotationIds}
            replyDraft={replyDraft}
            savingReply={savingReply}
            editDraft={editDraft}
            savingEdit={savingEdit}
            onSelectAnnotation={onSelectAnnotation}
            onReplyStart={onReplyStart}
            onReplyChange={onReplyChange}
            onReplyCancel={onReplyCancel}
            onReplySubmit={onReplySubmit}
            onReplyAgentToggle={onReplyAgentToggle}
            onCancelCopilotRun={onCancelCopilotRun}
            onRetryCopilotRun={onRetryCopilotRun}
            onEditStart={onEditStart}
            onEditChange={onEditChange}
            onEditCancel={onEditCancel}
            onEditSubmit={onEditSubmit}
            onArchiveToggle={onArchiveToggle}
            onDeleteAnnotation={onDeleteAnnotation}
            onCreateMemoryFromAnnotation={onCreateMemoryFromAnnotation}
            onOpenQuoteDetail={setQuoteDetailAnnotation}
            onOpenThreadDetail={setThreadDetailAnnotation}
          />
        ))}

        {draft ? (
          <CommentDraftCard
            draft={draft}
            draftTop={draftTop ?? draft.anchorTop}
            agents={agents}
            savingDraft={savingDraft}
            onDraftChange={onDraftChange}
            onDraftCancel={onDraftCancel}
            onDraftSubmit={onDraftSubmit}
            onDraftAgentToggle={onDraftAgentToggle}
          />
        ) : null}
      </div>

      <ArchivedThreadsDock
        open={archivedOpen}
        archivedAnnotations={archivedAnnotations}
        onToggleOpen={() => setArchivedOpen((current) => !current)}
        onSelectAnnotation={onSelectAnnotation}
        onArchiveToggle={onArchiveToggle}
      />

      {quoteDetailAnnotation ? (
        <QuoteDetailOverlay annotation={quoteDetailAnnotation} onClose={() => setQuoteDetailAnnotation(null)} />
      ) : null}

      {threadDetailAnnotation ? (
        <ThreadDetailOverlay
          annotation={threadDetailAnnotation}
          focusCommentId={focusCommentId}
          agents={agents}
          onClose={() => setThreadDetailAnnotation(null)}
          onReplyStart={(target) => {
            onReplyStart(threadDetailAnnotation.id, target)
            setThreadDetailAnnotation(null)
          }}
          onEditStart={(comment) => {
            onEditStart(threadDetailAnnotation.id, comment)
            setThreadDetailAnnotation(null)
          }}
        />
      ) : null}
    </aside>
  )
}
