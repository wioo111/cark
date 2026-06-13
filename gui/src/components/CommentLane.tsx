import type { MouseEvent, ReactNode } from 'react'
import { Archive, Bot, ChevronDown, ChevronUp, MessageSquarePlus, Pencil, Send, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AnnotationComment, PaperAnnotation, PaperView } from '@/types'

export interface AnnotationComposerDraft {
  view: PaperView
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop: number
  anchorHeight: number
  content: string
}

export interface AnnotationReplyDraft {
  annotationId: string
  content: string
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
  draft: AnnotationComposerDraft | null
  savingDraft: boolean
  replyDraft: AnnotationReplyDraft | null
  savingReply: boolean
  editDraft: AnnotationEditDraft | null
  savingEdit: boolean
  onDraftChange: (value: string) => void
  onDraftCancel: () => void
  onDraftSubmit: () => void
  onSelectAnnotation: (annotationId: string) => void
  onReplyStart: (annotationId: string) => void
  onReplyChange: (value: string) => void
  onReplyCancel: () => void
  onReplySubmit: () => void
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
  draft,
  savingDraft,
  replyDraft,
  savingReply,
  editDraft,
  savingEdit,
  onDraftChange,
  onDraftCancel,
  onDraftSubmit,
  onSelectAnnotation,
  onReplyStart,
  onReplyChange,
  onReplyCancel,
  onReplySubmit,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditSubmit,
  onArchiveToggle,
  onDeleteAnnotation,
}: CommentLaneProps) {
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [archivedOpen, setArchivedOpen] = useState(false)
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
      const expanded = expandedIds.includes(annotation.id)
      const estimatedHeight = estimateCardHeight(annotation, expanded)
      const top = Math.max(annotation.anchorTop, previousBottom + 14)
      previousBottom = top + estimatedHeight
      return { annotation, expanded, top, estimatedHeight }
    })
  }, [expandedIds, visibleAnnotations])

  return (
    <aside className="relative">
      <div className="relative" style={{ minHeight: `${Math.max(laneHeight, 200)}px` }}>
        {placements.map(({ annotation, expanded, top, estimatedHeight }) => {
          const hasOverflow = needsExpansion(annotation)
          const orderedComments = orderComments(annotation.comments)
          const leadComment = orderedComments[0]
          return (
            <article
              key={annotation.id}
              className="absolute left-0 right-0 cursor-pointer rounded-[24px] border border-white/10 bg-white/[0.025] shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur transition hover:border-white/20 hover:bg-white/[0.04]"
              style={{ top: `${top}px`, minHeight: `${estimatedHeight}px` }}
              onClick={() => onSelectAnnotation(annotation.id)}
            >
              <div className="border-b border-white/8 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm text-zinc-100">{leadComment?.preview ?? '评论预览'}</p>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-zinc-500">{annotation.quote}</p>
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
                  const shouldCollapse = !expanded && (index >= 2 || comment.content.length > 200)
                  if (shouldCollapse) {
                    return null
                  }

                  return (
                    <section
                      key={comment.id}
                      className={[
                        'rounded-[18px] border px-3 py-3',
                        isUser
                          ? 'border-amber-300/20 bg-amber-300/[0.06]'
                          : 'border-sky-300/15 bg-sky-300/[0.05]',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          {isUser ? <MessageSquarePlus className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                          <span>{comment.authorLabel}</span>
                          {comment.status === 'pending' ? <span className="text-sky-300/80">待生成</span> : null}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-zinc-500">{formatTimeLabel(comment.updatedAt || comment.createdAt)}</span>
                          {isUser ? (
                            <IconActionButton
                              title="编辑评论"
                              onClick={(event) => {
                                event.stopPropagation()
                                onEditStart(annotation.id, comment)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </IconActionButton>
                          ) : null}
                        </div>
                      </div>
                      {editDraft?.annotationId === annotation.id && editDraft.commentId === comment.id ? (
                        <div className="mt-2">
                          <textarea
                            autoFocus
                            value={editDraft.content}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => onEditChange(event.target.value)}
                            className="h-24 w-full resize-none rounded-[16px] border border-white/10 bg-black/25 px-3 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-300/30"
                          />
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onEditCancel()
                              }}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
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
                              className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Send className="h-3.5 w-3.5" />
                              {savingEdit ? '保存中' : '保存修改'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className={['mt-2 text-sm leading-7 text-zinc-200', expanded ? '' : 'line-clamp-4'].join(' ')}>
                          {comment.content}
                        </p>
                      )}
                    </section>
                  )
                })}

                {hasOverflow ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpandedIds((current) =>
                        expanded ? current.filter((id) => id !== annotation.id) : [...current, annotation.id],
                      )
                    }}
                    className="inline-flex items-center gap-2 text-xs text-zinc-400 transition hover:text-zinc-100"
                  >
                    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {expanded ? '收起评论' : '展开全部评论'}
                  </button>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onReplyStart(annotation.id)
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    继续评论
                  </button>
                </div>

                {replyDraft?.annotationId === annotation.id ? (
                  <section className="rounded-[18px] border border-amber-300/20 bg-amber-300/[0.05] px-3 py-3">
                    <textarea
                      autoFocus
                      value={replyDraft.content}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onReplyChange(event.target.value)}
                      placeholder="继续写下你的评论"
                      className="h-24 w-full resize-none rounded-[16px] border border-white/10 bg-black/25 px-3 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-300/30"
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onReplyCancel()
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
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
                        className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {savingReply ? '保存中' : '追加评论'}
                      </button>
                    </div>
                  </section>
                ) : null}
              </div>
            </article>
          )
        })}

        {draft ? (
          <article
            className="absolute left-0 right-0 rounded-[24px] border border-amber-300/20 bg-[#14110b]/92 shadow-[0_20px_70px_rgba(0,0,0,0.3)] backdrop-blur"
            style={{ top: `${draft.anchorTop}px`, minHeight: `${Math.max(draft.anchorHeight + 118, 150)}px` }}
          >
            <div className="border-b border-white/8 px-4 py-3">
              <p className="line-clamp-2 text-[12px] leading-5 text-zinc-400">{draft.quote}</p>
            </div>
            <div className="px-4 py-4">
              <textarea
                autoFocus
                value={draft.content}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="写下你的评论、质疑或补充判断"
                className="h-28 w-full resize-none rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-300/30"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onDraftCancel}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
                >
                  <X className="h-3.5 w-3.5" />
                  取消
                </button>
                <button
                  type="button"
                  onClick={onDraftSubmit}
                  disabled={savingDraft}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  {savingDraft ? '保存中' : '保存评论'}
                </button>
              </div>
            </div>
          </article>
        ) : null}
      </div>

      <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setArchivedOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">归档区</p>
            <p className="mt-1 text-sm text-zinc-300">已归档 {archivedAnnotations.length} 条线程</p>
          </div>
          {archivedOpen ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
        </button>

        {archivedOpen && archivedAnnotations.length > 0 ? (
          <div className="border-t border-white/8 px-3 py-3">
            <div className="space-y-2">
              {archivedAnnotations.map((annotation) => (
                <div
                  key={annotation.id}
                  onClick={() => onSelectAnnotation(annotation.id)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-[16px] border border-white/8 bg-black/15 px-3 py-3 text-left transition hover:border-white/16 hover:bg-black/25"
                >
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm text-zinc-200">{annotation.comments[0]?.preview ?? '已归档评论'}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{annotation.quote}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onArchiveToggle(annotation.id, false)
                    }}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
                  >
                    还原
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : archivedOpen ? (
          <div className="border-t border-white/8 px-4 py-3 text-sm text-zinc-500">还没有归档线程。</div>
        ) : null}
      </div>
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
        'inline-flex h-8 w-8 items-center justify-center rounded-full border text-zinc-400 transition',
        danger
          ? 'border-rose-400/20 hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-200'
          : 'border-white/10 hover:border-white/25 hover:bg-white/5 hover:text-zinc-100',
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

function estimateCardHeight(annotation: PaperAnnotation, expanded: boolean) {
  const totalLength = annotation.comments.reduce((sum, item) => sum + item.content.length, 0)
  if (expanded) {
    return Math.max(annotation.anchorHeight + 150, 180 + totalLength * 0.35)
  }
  return Math.max(annotation.anchorHeight + 96, 138)
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
