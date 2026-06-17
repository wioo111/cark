import type { MouseEvent, ReactNode } from 'react'
import { Archive, Bot, ChevronDown, CornerDownLeft, MessageSquarePlus, Pencil, Send, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { MarkdownComment } from '@/components/MarkdownComment'
import type { AnnotationComment, CopilotAgentConfig, PaperAnnotation, PaperView } from '@/types'

export interface AnnotationComposerDraft {
  view: PaperView
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop: number
  anchorHeight: number
  content: string
  mentionAgentIds: string[]
}

export interface AnnotationReplyDraft {
  annotationId: string
  content: string
  mentionAgentIds: string[]
  followUpCommentId?: string | null
  followUpAgentId?: string | null
  followUpAgentLabel?: string | null
  followUpPreview?: string | null
}

export interface AnnotationReplyTarget {
  commentId?: string | null
  agentId?: string | null
  agentLabel?: string | null
  commentPreview?: string | null
}

export interface AnnotationEditDraft {
  annotationId: string
  commentId: string
  content: string
}

interface CommentLaneProps {
  annotations: PaperAnnotation[]
  activeView: PaperView
  laneHeight: number
  agents: CopilotAgentConfig[]
  draft: AnnotationComposerDraft | null
  savingDraft: boolean
  replyDraft: AnnotationReplyDraft | null
  savingReply: boolean
  editDraft: AnnotationEditDraft | null
  savingEdit: boolean
  onDraftChange: (value: string) => void
  onDraftCancel: () => void
  onDraftSubmit: () => void
  onDraftAgentToggle: (agentId: string) => void
  onSelectAnnotation: (annotationId: string) => void
  onReplyStart: (annotationId: string, target?: AnnotationReplyTarget) => void
  onReplyChange: (value: string) => void
  onReplyCancel: () => void
  onReplySubmit: () => void
  onReplyAgentToggle: (agentId: string) => void
  onEditStart: (annotationId: string, comment: AnnotationComment) => void
  onEditChange: (value: string) => void
  onEditCancel: () => void
  onEditSubmit: () => void
  onArchiveToggle: (annotationId: string, nextArchived: boolean) => void
  onDeleteAnnotation: (annotationId: string) => void
}

export function CommentLane({
  annotations,
  activeView,
  laneHeight,
  agents,
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
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditSubmit,
  onArchiveToggle,
  onDeleteAnnotation,
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

  return (
    <aside className="relative">
      <div ref={laneRef} className="relative" style={{ minHeight: `${Math.max(laneHeight, 200)}px` }}>
        {placements.map(({ annotation, top }) => {
          const hasOverflow = needsExpansion(annotation)
          const orderedComments = orderComments(annotation.comments)
          const leadComment = orderedComments[0]
          const compactMinHeight = estimateCardHeight(annotation)
          return (
            <article
              key={annotation.id}
              data-measure-key={annotation.id}
              className="cark-card absolute left-0 right-0 cursor-pointer rounded-[24px] shadow-[0_18px_60px_rgba(0,0,0,0.12)] backdrop-blur transition hover:border-[rgba(var(--accent-rgb),0.25)] hover:bg-[var(--surface-soft)]"
              style={{ top: `${top}px`, minHeight: `${compactMinHeight}px` }}
              onClick={() => onSelectAnnotation(annotation.id)}
            >
              <div className="border-b px-4 py-3 [border-color:var(--border-soft)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="cark-title line-clamp-1 text-sm">{leadComment?.preview ?? '评论预览'}</p>
                    <p className="cark-faint mt-1 line-clamp-2 text-[12px] leading-5">{annotation.quote}</p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setQuoteDetailAnnotation(annotation)
                      }}
                      className="cark-faint mt-2 inline-flex text-xs transition hover:text-[var(--text-primary)]"
                    >
                      查看引文详情
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconActionButton
                      title="归档线程"
                      onClick={(event) => {
                        event.stopPropagation()
                        onArchiveToggle(annotation.id, true)
                      }}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </IconActionButton>
                    <IconActionButton
                      title="删除线程"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteAnnotation(annotation.id)
                      }}
                      danger
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconActionButton>
                  </div>
                </div>
              </div>

              <div className="space-y-3 px-4 py-4">
                {orderedComments.map((comment, index) => {
                  const isUser = comment.authorType === 'user'
                  const shouldCollapse = index >= 2 || comment.content.length > 200
                  if (shouldCollapse) {
                    return null
                  }

                  const inlineFollowUpReply =
                    replyDraft?.annotationId === annotation.id && replyDraft.followUpCommentId === comment.id

                  if (!isUser) {
                    return (
                      <AgentCommentCard
                        key={comment.id}
                        annotationId={annotation.id}
                        comment={comment}
                        agents={agents}
                        inlineReplyDraft={inlineFollowUpReply ? replyDraft : null}
                        savingReply={savingReply}
                        onReplyStart={onReplyStart}
                        onReplyChange={onReplyChange}
                        onReplyCancel={onReplyCancel}
                        onReplySubmit={onReplySubmit}
                      />
                    )
                  }

                  return (
                    <section
                      key={comment.id}
                      className="rounded-[18px] border border-amber-300/20 bg-amber-300/[0.06] px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="cark-faint inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
                          <MessageSquarePlus className="h-3.5 w-3.5" />
                          <span>{comment.authorLabel}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="cark-faint text-[11px]">{formatTimeLabel(comment.updatedAt || comment.createdAt)}</span>
                          <IconActionButton
                            title="编辑评论"
                            onClick={(event) => {
                              event.stopPropagation()
                              onEditStart(annotation.id, comment)
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </IconActionButton>
                        </div>
                      </div>
                      {editDraft?.annotationId === annotation.id && editDraft.commentId === comment.id ? (
                        <div className="mt-2">
                          <textarea
                            autoFocus
                            value={editDraft.content}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => onEditChange(event.target.value)}
                            className="cark-input h-24 w-full resize-none rounded-[16px] px-3 py-3 text-sm leading-7 outline-none transition"
                          />
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onEditCancel()
                              }}
                              className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
                            >
                              <X className="h-3.5 w-3.5" />
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onEditSubmit()
                              }}
                              disabled={savingEdit}
                              className="cark-button-accent inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Send className="h-3.5 w-3.5" />
                              {savingEdit ? '保存中' : '保存修改'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 max-h-[10.5rem] overflow-hidden">
                          <MarkdownComment content={comment.content} />
                        </div>
                      )}
                    </section>
                  )
                })}

                {hasOverflow ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setThreadDetailAnnotation(annotation)
                    }}
                    className="cark-faint inline-flex items-center gap-2 text-xs transition hover:text-[var(--text-primary)]"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    展开全部评论
                  </button>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onReplyStart(annotation.id)
                      }}
                    className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    继续评论
                  </button>
                </div>

                {replyDraft?.annotationId === annotation.id && !replyDraft.followUpCommentId ? (
                  <section className="rounded-[18px] border border-amber-300/20 bg-amber-300/[0.05] px-3 py-3">
                    {replyDraft.followUpAgentLabel ? (
                      <div className="mb-3 rounded-[16px] border border-sky-300/18 bg-sky-300/[0.06] px-3 py-3">
                        <div className="cark-faint inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
                          <CornerDownLeft className="h-3.5 w-3.5" />
                          <span>继续追问 @{replyDraft.followUpAgentLabel}</span>
                        </div>
                        {replyDraft.followUpPreview ? (
                          <p className="cark-muted mt-2 line-clamp-3 text-[12px] leading-5">{replyDraft.followUpPreview}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {(replyDraft.mentionAgentIds ?? []).length > 0 ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {renderMentionChips(replyDraft.mentionAgentIds, agents)}
                      </div>
                    ) : null}
                    <textarea
                      autoFocus
                      value={replyDraft.content}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onReplyChange(event.target.value)}
                      placeholder={replyDraft.followUpAgentLabel ? `继续追问 @${replyDraft.followUpAgentLabel}` : '继续写下你的评论'}
                      className="cark-input h-24 w-full resize-none rounded-[16px] px-3 py-3 text-sm leading-7 outline-none transition"
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onReplyCancel()
                        }}
                        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
                      >
                        <X className="h-3.5 w-3.5" />
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onReplySubmit()
                        }}
                        disabled={savingReply}
                        className="cark-button-accent inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {savingReply
                          ? '发送中'
                          : replyDraft.followUpAgentLabel
                            ? '发送追问'
                            : (replyDraft.mentionAgentIds ?? []).length > 0
                              ? '发送并提问'
                              : '发送评论'}
                      </button>
                    </div>
                    {agents.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 [border-color:var(--border-soft)]">
                        <span className="cark-faint text-[11px] uppercase tracking-[0.18em]">可选助手</span>
                        {agents.map((agent) => {
                          const mentioned = (replyDraft.mentionAgentIds ?? []).includes(agent.id)
                          return (
                            <button
                              key={agent.id}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onReplyAgentToggle(agent.id)
                              }}
                              disabled={savingReply}
                              className={[
                                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60',
                                mentioned ? 'cark-button-accent' : 'cark-button-secondary',
                              ].join(' ')}
                            >
                              <Bot className="h-3.5 w-3.5" />
                              {mentioned ? `@${agent.name}` : agent.name}
                            </button>
                          )
                        })}
                        <span className="cark-faint text-[11px]">不选助手，只发评论</span>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </article>
          )
        })}

        {draft ? (
          <article
            data-measure-key={draftMeasurementKey}
            className="absolute left-0 right-0 rounded-[24px] border border-amber-300/20 bg-[var(--surface-elevated)] shadow-[0_20px_70px_rgba(0,0,0,0.16)] backdrop-blur"
            style={{
              top: `${draftTop ?? draft.anchorTop}px`,
              minHeight: `${estimateDraftHeight(draft)}px`,
            }}
          >
            <div className="border-b px-4 py-3 [border-color:var(--border-soft)]">
              <p className="cark-muted line-clamp-2 text-[12px] leading-5">{draft.quote}</p>
            </div>
            <div className="px-4 py-4">
              {(draft.mentionAgentIds ?? []).length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {renderMentionChips(draft.mentionAgentIds, agents)}
                </div>
              ) : null}
              <textarea
                autoFocus
                value={draft.content}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="写下你的评论、质疑或补充判断"
                className="cark-input h-28 w-full resize-none rounded-[18px] px-3 py-3 text-sm leading-7 outline-none transition"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onDraftCancel}
                  className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                  取消
                </button>
                <button
                  type="button"
                  onClick={onDraftSubmit}
                  disabled={savingDraft}
                  className="cark-button-accent inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  {savingDraft ? '发送中' : (draft.mentionAgentIds ?? []).length > 0 ? '发送并提问' : '保存评论'}
                </button>
              </div>
              {agents.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 [border-color:var(--border-soft)]">
                  <span className="cark-faint text-[11px] uppercase tracking-[0.18em]">准备提问</span>
                  {agents.map((agent) => {
                    const mentioned = (draft.mentionAgentIds ?? []).includes(agent.id)
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => onDraftAgentToggle(agent.id)}
                        disabled={savingDraft}
                        className={[
                          'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60',
                          mentioned ? 'cark-button-accent' : 'cark-button-secondary',
                        ].join(' ')}
                      >
                        <Bot className="h-3.5 w-3.5" />
                        {mentioned ? `@${agent.name}` : agent.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="cark-faint mt-3 text-xs leading-6">先在设置里补齐至少一个智能体，评论区才会出现共读回复。</p>
              )}
            </div>
          </article>
        ) : null}
      </div>

      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 xl:right-8">
        {archivedOpen ? (
          <div className="cark-card cark-elevated w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-[24px]">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 [border-color:var(--border-soft)]">
              <div>
                <p className="cark-faint text-xs uppercase tracking-[0.18em]">归档区</p>
                <p className="cark-text mt-1 text-sm">已归档 {archivedAnnotations.length} 条线程</p>
              </div>
              <button
                type="button"
                onClick={() => setArchivedOpen(false)}
                className="cark-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="reader-scroll cark-contained-scroll max-h-[min(50vh,420px)] overflow-y-auto px-3 py-3">
              {archivedAnnotations.length > 0 ? (
                <div className="space-y-2">
                  {archivedAnnotations.map((annotation) => (
                    <div
                      key={annotation.id}
                      onClick={() => onSelectAnnotation(annotation.id)}
                      className="cark-soft flex cursor-pointer items-center justify-between gap-3 rounded-[16px] border [border-color:var(--border-soft)] px-3 py-3 text-left transition hover:border-[rgba(var(--accent-rgb),0.2)]"
                    >
                      <div className="min-w-0">
                        <p className="cark-text line-clamp-1 text-sm">{annotation.comments[0]?.preview ?? '已归档评论'}</p>
                        <p className="cark-faint mt-1 line-clamp-1 text-xs">{annotation.quote}</p>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onArchiveToggle(annotation.id, false)
                        }}
                        className="cark-button-secondary inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                      >
                        还原
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cark-faint px-2 py-1 text-sm">还没有归档线程。</div>
              )}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setArchivedOpen((current) => !current)}
          className="cark-panel cark-elevated inline-flex items-center gap-3 rounded-full px-4 py-3 text-sm backdrop-blur transition hover:border-[rgba(var(--accent-rgb),0.28)]"
        >
          <Archive className="h-4 w-4" />
          <span>归档 {archivedAnnotations.length}</span>
        </button>
      </div>

      {quoteDetailAnnotation ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[60] w-[min(calc(100vw-1.5rem),440px)] xl:right-8 xl:top-6">
          <section
            role="complementary"
            aria-label="引文详情"
            className="cark-card cark-elevated pointer-events-auto flex max-h-[min(72vh,760px)] w-full flex-col overflow-hidden rounded-[28px]"
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4 [border-color:var(--border-soft)]">
              <div className="min-w-0">
                <p className="cark-faint text-xs uppercase tracking-[0.18em]">引文详情</p>
                <p className="cark-text mt-1 text-sm">{quoteDetailAnnotation.view === 'bilingual' ? '译文版本' : '原文'}</p>
              </div>
              <button
                type="button"
                onClick={() => setQuoteDetailAnnotation(null)}
                className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="reader-scroll cark-contained-scroll space-y-4 overflow-y-auto px-5 py-5">
              {quoteDetailAnnotation.contextBefore ? (
                <QuoteDetailBlock label="前文" tone="muted" content={quoteDetailAnnotation.contextBefore} />
              ) : null}
              <QuoteDetailBlock label="引文" tone="accent" content={quoteDetailAnnotation.quote} />
              {quoteDetailAnnotation.contextAfter ? (
                <QuoteDetailBlock label="后文" tone="muted" content={quoteDetailAnnotation.contextAfter} />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {threadDetailAnnotation ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[65] w-[min(calc(100vw-1.5rem),460px)] xl:right-8 xl:top-6">
          <section
            role="complementary"
            aria-label="评论详情"
            className="cark-card cark-elevated pointer-events-auto flex max-h-[min(76vh,880px)] w-full flex-col overflow-hidden rounded-[28px]"
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4 [border-color:var(--border-soft)]">
              <div className="min-w-0">
                <p className="cark-faint text-xs uppercase tracking-[0.18em]">评论详情</p>
                <p className="cark-text mt-1 text-sm">{threadDetailAnnotation.comments.length} 条评论</p>
              </div>
              <button
                type="button"
                onClick={() => setThreadDetailAnnotation(null)}
                className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="reader-scroll cark-contained-scroll space-y-4 overflow-y-auto px-5 py-5">
              {threadDetailAnnotation.contextBefore ? (
                <QuoteDetailBlock label="前文" tone="muted" content={threadDetailAnnotation.contextBefore} />
              ) : null}
              <QuoteDetailBlock label="引文" tone="accent" content={threadDetailAnnotation.quote} />
              {threadDetailAnnotation.contextAfter ? (
                <QuoteDetailBlock label="后文" tone="muted" content={threadDetailAnnotation.contextAfter} />
              ) : null}
              <div className="space-y-3">
                {orderComments(threadDetailAnnotation.comments).map((comment) => (
                  <ThreadDetailComment
                    key={comment.id}
                    comment={comment}
                    agents={agents}
                    onReplyStart={(target) => {
                      onReplyStart(threadDetailAnnotation.id, target)
                      setThreadDetailAnnotation(null)
                    }}
                    onEditStart={(commentValue) => {
                      onEditStart(threadDetailAnnotation.id, commentValue)
                      setThreadDetailAnnotation(null)
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  )
}

function IconActionButton({
  children,
  title,
  onClick,
  danger = false,
}: {
  children: ReactNode
  title: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        'inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
        danger
          ? 'border-rose-400/20 hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-200'
          : 'cark-button-secondary cark-faint',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function orderComments<T extends { authorType: 'user' | 'agent'; createdAt: string }>(comments: T[]) {
  return [...comments].sort((left, right) => {
    if (left.authorType !== right.authorType) {
      return left.authorType === 'user' ? -1 : 1
    }
    return left.createdAt.localeCompare(right.createdAt)
  })
}

const draftMeasurementKey = '__draft__'

function estimateCardHeight(annotation: PaperAnnotation) {
  return Math.max(annotation.anchorHeight + 96, 138)
}

function estimateDraftHeight(draft: AnnotationComposerDraft) {
  return Math.max(draft.anchorHeight + 148, 214)
}

function areMeasuredHeightsEqual(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  return leftKeys.every((key) => left[key] === right[key])
}

function needsExpansion(annotation: PaperAnnotation) {
  return annotation.comments.length > 2 || annotation.comments.some((comment) => comment.content.length > 200)
}

function formatTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function renderMentionChips(agentIds: string[], agents: CopilotAgentConfig[]) {
  return agentIds.map((agentId) => {
    const agent = agents.find((item) => item.id === agentId)
    if (!agent) {
      return null
    }
    return (
      <span
        key={agentId}
        className="cark-chip-accent inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
      >
        <Bot className="h-3.5 w-3.5" />
        @{agent.name}
      </span>
    )
  })
}

function resolveCommentAgentId(comment: AnnotationComment, agents: CopilotAgentConfig[]) {
  if (comment.agentId) {
    return comment.agentId
  }
  const exact = agents.find((agent) => agent.name.trim() === comment.authorLabel.trim())
  return exact?.id ?? null
}

function QuoteDetailBlock({
  label,
  content,
  tone,
}: {
  label: string
  content: string
  tone: 'accent' | 'muted'
}) {
  return (
    <section
      className={[
        'rounded-[20px] border px-4 py-4',
        tone === 'accent'
          ? 'border-[rgba(var(--accent-rgb),0.25)] bg-[rgba(var(--accent-rgb),0.08)]'
          : '[border-color:var(--border-soft)] bg-[var(--surface-soft)]',
      ].join(' ')}
    >
      <p className="cark-faint text-[11px] uppercase tracking-[0.18em]">{label}</p>
      <p className="cark-text mt-2 break-all text-sm leading-7">{content}</p>
    </section>
  )
}

function AgentCommentCard({
  annotationId,
  comment,
  agents,
  inlineReplyDraft,
  savingReply,
  onReplyStart,
  onReplyChange,
  onReplyCancel,
  onReplySubmit,
}: {
  annotationId: string
  comment: AnnotationComment
  agents: CopilotAgentConfig[]
  inlineReplyDraft: AnnotationReplyDraft | null
  savingReply: boolean
  onReplyStart: (annotationId: string, target?: AnnotationReplyTarget) => void
  onReplyChange: (value: string) => void
  onReplyCancel: () => void
  onReplySubmit: () => void
}) {
  const actionTarget = {
    commentId: comment.id,
    agentId: resolveCommentAgentId(comment, agents),
    agentLabel: comment.authorLabel,
    commentPreview: comment.preview || comment.content,
  }

  return (
    <section className="overflow-hidden rounded-[20px] border border-sky-300/15 bg-[var(--surface-soft)]">
      <div className="flex items-center justify-between gap-3 border-b bg-[rgba(var(--accent-rgb),0.08)] px-3 py-2 [border-color:var(--border-soft)]">
        <div className="min-w-0">
          <p className="cark-faint text-[11px] uppercase tracking-[0.18em]">当前共读助手回复</p>
          {comment.status === 'pending' ? <p className="mt-1 text-[11px] text-sky-300/80">生成中</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="cark-faint text-[11px]">{formatTimeLabel(comment.updatedAt || comment.createdAt)}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onReplyStart(annotationId, actionTarget)
            }}
            className="cark-button-secondary inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
            追问
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(var(--accent-rgb),0.16)] text-[rgb(var(--accent-rgb))]">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="cark-title text-sm">{comment.authorLabel}</p>
              <span className="cark-faint text-xs">共读助手</span>
            </div>
            <div className="mt-2 max-h-[10.5rem] overflow-hidden">
              <MarkdownComment content={comment.content} />
            </div>
          </div>
        </div>

        {inlineReplyDraft ? (
          <div className="mt-3 rounded-[16px] border border-[rgba(var(--accent-rgb),0.25)] bg-[var(--surface-elevated)] p-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="cark-faint text-[11px] uppercase tracking-[0.18em]">继续追问 {comment.authorLabel}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onReplyCancel()
                }}
                className="cark-faint text-xs transition hover:text-[var(--text-primary)]"
              >
                取消
              </button>
            </div>
            <div className="rounded-[14px] border border-[rgba(var(--accent-rgb),0.35)] bg-[var(--surface-input)] px-3 py-2">
              <textarea
                autoFocus
                value={inlineReplyDraft.content}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onReplyChange(event.target.value)}
                placeholder={`继续追问 @${comment.authorLabel}`}
                className="min-h-[38px] w-full resize-none bg-transparent text-sm leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="cark-faint line-clamp-1 text-[11px]">只会继续追问这位助手，不会默认召唤其他助手</p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onReplySubmit()
                }}
                disabled={savingReply}
                className="cark-button-accent inline-flex h-8 w-8 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
                title={savingReply ? '发送中' : '发送追问'}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onReplyStart(annotationId, actionTarget)
              }}
              className="cark-agent-inline-trigger inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-sm"
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
              追问这个助手
            </button>
            <span className="cark-faint text-xs">线程外的“继续评论”只发普通评论</span>
          </div>
        )}
      </div>
    </section>
  )
}

function ThreadDetailComment({
  comment,
  agents,
  onReplyStart,
  onEditStart,
}: {
  comment: AnnotationComment
  agents: CopilotAgentConfig[]
  onReplyStart: (target: AnnotationReplyTarget) => void
  onEditStart: (comment: AnnotationComment) => void
}) {
  const isUser = comment.authorType === 'user'
  return (
    <section
      className={[
        'rounded-[20px] border px-4 py-4',
        isUser
          ? 'border-amber-300/20 bg-amber-300/[0.06]'
          : 'border-sky-300/15 bg-sky-300/[0.05] text-[var(--text-secondary)]',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="cark-faint inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
          {isUser ? <MessageSquarePlus className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          <span>{comment.authorLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="cark-faint text-[11px]">{formatTimeLabel(comment.updatedAt || comment.createdAt)}</span>
          {isUser ? (
            <IconActionButton
              title="编辑评论"
              onClick={(event) => {
                event.stopPropagation()
                onEditStart(comment)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconActionButton>
          ) : (
            <IconActionButton
              title="继续追问"
              onClick={(event) => {
                event.stopPropagation()
                onReplyStart({
                  commentId: comment.id,
                  agentId: resolveCommentAgentId(comment, agents),
                  agentLabel: comment.authorLabel,
                  commentPreview: comment.preview || comment.content,
                })
              }}
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
            </IconActionButton>
          )}
        </div>
      </div>
      <div className="mt-3">
        <MarkdownComment content={comment.content} />
      </div>
    </section>
  )
}
