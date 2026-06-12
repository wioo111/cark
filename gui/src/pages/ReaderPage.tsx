import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FolderOpen, PanelLeft, RefreshCw, X } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import {
  deletePaperAnnotation,
  fetchPaperAnnotations,
  fetchPaperDetail,
  patchAnnotationComment,
  patchPaperAnnotation,
  postAnnotationComment,
  postOpenAction,
  postPaperAnnotation,
} from '@/api'
import { type AnnotationComposerDraft, type AnnotationEditDraft, type AnnotationReplyDraft, CommentLane } from '@/components/CommentLane'
import { MarkdownArticle } from '@/components/MarkdownArticle'
import { OutlineNav } from '@/components/OutlineNav'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { CreatePaperAnnotationInput, PaperAnnotation, PaperDetail, PaperView } from '@/types'
import { findBestAnnotationMatch, normalizeAnnotationText, resolveAnnotationAnchor } from '@/utils/annotationLocator'
import { extractOutline, formatUpdatedAt, getPreferredView } from '@/utils/paper'

const viewOptions: Array<{ key: PaperView; label: string }> = [
  { key: 'linearized', label: '结构化原文' },
  { key: 'bilingual', label: '中英双语' },
]

export default function ReaderPage() {
  const { paperId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const rememberPaper = useWorkspaceStore((state) => state.rememberPaper)
  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [laneHeight, setLaneHeight] = useState(0)
  const [toolbarSelection, setToolbarSelection] = useState<SelectionToolbarState | null>(null)
  const [draft, setDraft] = useState<AnnotationComposerDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [replyDraft, setReplyDraft] = useState<AnnotationReplyDraft | null>(null)
  const [savingReply, setSavingReply] = useState(false)
  const [editDraft, setEditDraft] = useState<AnnotationEditDraft | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [positionedAnnotations, setPositionedAnnotations] = useState<PaperAnnotation[]>([])
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null)
  const articleShellRef = useRef<HTMLDivElement | null>(null)
  const articleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    rememberPaper(paperId)
  }, [paperId, rememberPaper])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchPaperDetail(paperId)
      .then(async (detailPayload) => {
        if (cancelled) {
          return
        }

        setDetail(detailPayload)

        try {
          const annotationPayload = await fetchPaperAnnotations(paperId)
          if (!cancelled) {
            setAnnotations(annotationPayload)
          }
        } catch {
          if (!cancelled) {
            setAnnotations([])
          }
        } finally {
          if (!cancelled) {
            setLoading(false)
          }
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : '加载论文失败')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [paperId])

  useEffect(() => {
    document.title = detail ? `${detail.title} | cark` : 'cark'
  }, [detail])

  const activeView = useMemo<PaperView>(() => {
    if (!detail) {
      return 'linearized'
    }
    const requested = searchParams.get('view') as PaperView | null
    return requested && detail.availableViews.includes(requested)
      ? requested
      : getPreferredView(detail.availableViews)
  }, [detail, searchParams])

  const markdown = detail?.markdown[activeView] ?? ''
  const outline = useMemo(() => extractOutline(markdown), [markdown])

  useEffect(() => {
    const container = articleRef.current
    if (!container) {
      return
    }

    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    headings.forEach((element, index) => {
      const id = outline[index]?.id ?? `section-${index + 1}`
      element.setAttribute('id', id)
    })

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]

        if (visible?.target instanceof HTMLElement) {
          setActiveSectionId(visible.target.id)
        }
      },
      {
        rootMargin: '-25% 0px -55% 0px',
        threshold: [0.1, 0.4, 0.7],
      },
    )

    headings.forEach((element) => observer.observe(element))

    return () => {
      observer.disconnect()
    }
  }, [outline, markdown])

  useEffect(() => {
    const articleShell = articleShellRef.current
    if (!articleShell) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setLaneHeight(entry.contentRect.height)
      }
    })
    observer.observe(articleShell)
    setLaneHeight(articleShell.getBoundingClientRect().height)

    return () => {
      observer.disconnect()
    }
  }, [markdown, annotations.length, draft])

  useEffect(() => {
    const articleContainer = articleRef.current
    const articleShell = articleShellRef.current
    if (!articleContainer || !articleShell) {
      setPositionedAnnotations(annotations)
      return
    }

    let animationFrame = 0
    const recompute = () => {
      setPositionedAnnotations(
        annotations.map((annotation) => {
          if (annotation.view !== activeView) {
            return annotation
          }
          const resolved = resolveAnnotationAnchor(articleContainer, articleShell, annotation)
          return resolved
            ? { ...annotation, anchorTop: resolved.top, anchorHeight: resolved.height }
            : annotation
        }),
      )
    }

    const scheduleRecompute = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(recompute)
    }

    scheduleRecompute()
    const observer = new ResizeObserver(() => {
      scheduleRecompute()
    })
    observer.observe(articleContainer)
    observer.observe(articleShell)
    window.addEventListener('resize', scheduleRecompute)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleRecompute)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [activeView, annotations, markdown])

  useEffect(() => {
    const articleContainer = articleRef.current
    if (!articleContainer) {
      return
    }

    clearInlineAnnotationMarkers(articleContainer)
    const visible = positionedAnnotations.filter((annotation) => annotation.view === activeView && !annotation.archived)
    const nodeCount = new Map<HTMLElement, number>()
    for (const annotation of visible) {
      const match = findBestAnnotationMatch(articleContainer, annotation)
      if (match) {
        nodeCount.set(match.element, (nodeCount.get(match.element) ?? 0) + 1)
      }
    }

    for (const [element, count] of nodeCount.entries()) {
      element.classList.add('annotation-inline-marked')
      element.setAttribute('data-annotation-count', String(count))
      element.setAttribute('data-annotation-marked', 'true')
    }

    return () => {
      clearInlineAnnotationMarkers(articleContainer)
    }
  }, [activeView, positionedAnnotations])

  useEffect(() => {
    const articleContainer = articleRef.current
    if (!articleContainer || !focusedAnnotationId) {
      return
    }

    const targetAnnotation = positionedAnnotations.find((annotation) => annotation.id === focusedAnnotationId)
    if (!targetAnnotation || targetAnnotation.view !== activeView) {
      return
    }

    const match = findBestAnnotationMatch(articleContainer, targetAnnotation)
    if (!match) {
      return
    }

    clearFocusedAnnotation(articleContainer)
    const target = match.element
    target.classList.add('annotation-focus-active')
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })

    const timeout = window.setTimeout(() => {
      target.classList.remove('annotation-focus-active')
    }, 2200)

    return () => {
      window.clearTimeout(timeout)
      target.classList.remove('annotation-focus-active')
    }
  }, [activeView, focusedAnnotationId, positionedAnnotations])

  useEffect(() => {
    const handleWindowChange = () => {
      setToolbarSelection(null)
    }
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setToolbarSelection(null)
      }
    }

    window.addEventListener('scroll', handleWindowChange, true)
    window.addEventListener('resize', handleWindowChange)
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      window.removeEventListener('scroll', handleWindowChange, true)
      window.removeEventListener('resize', handleWindowChange)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [])

  function setView(view: PaperView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('view', view)
      return next
    })
  }

  function jumpToHeading(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOutlineOpen(false)
  }

  function handleSelectionCapture() {
    const nextSelection = readSelection(articleRef.current, articleShellRef.current, activeView)
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

  function handleDraftStart() {
    if (!toolbarSelection) {
      return
    }
    setDraft({
      view: toolbarSelection.view,
      quote: toolbarSelection.quote,
      contextBefore: toolbarSelection.contextBefore,
      contextAfter: toolbarSelection.contextAfter,
      anchorTop: toolbarSelection.anchorTop,
      anchorHeight: toolbarSelection.anchorHeight,
      content: '',
    })
    clearBrowserSelection()
    setToolbarSelection(null)
  }

  async function handleAgentSummon() {
    if (!detail || !toolbarSelection) {
      return
    }
    const nextAnnotations = await upsertAnnotationComment(detail.id, annotations, toolbarSelection, {
        authorType: 'agent',
        authorLabel: '智能体评论',
        content: '已记录这条句子的评论请求。等待后续接入智能体编排后生成正式评价。',
        status: 'pending',
      })
    setAnnotations(nextAnnotations)
    setFocusedAnnotationId(findExistingAnnotationId(nextAnnotations, toolbarSelection))
    clearBrowserSelection()
    setToolbarSelection(null)
  }

  async function handleDraftSubmit() {
    if (!detail || !draft || !draft.content.trim()) {
      return
    }

    setSavingDraft(true)
    try {
      const nextAnnotations = await upsertAnnotationComment(detail.id, annotations, draft, {
          authorType: 'user',
          authorLabel: '我的评论',
          content: draft.content.trim(),
          status: 'ready',
        })
      setAnnotations(nextAnnotations)
      setFocusedAnnotationId(findExistingAnnotationId(nextAnnotations, draft))
      setDraft(null)
      clearBrowserSelection()
    } finally {
      setSavingDraft(false)
    }
  }

  function handleReplyStart(annotationId: string) {
    setEditDraft(null)
    setReplyDraft({ annotationId, content: '' })
  }

  async function handleReplyAgent(annotationId: string) {
    if (!detail) {
      return
    }
    setAnnotations(
      await postAnnotationComment(detail.id, annotationId, {
        authorType: 'agent',
        authorLabel: '智能体评论',
        content: '已记录追加评论请求。等待后续接入智能体编排后生成正式评价。',
        status: 'pending',
      }),
    )
  }

  async function handleReplySubmit() {
    if (!detail || !replyDraft || !replyDraft.content.trim()) {
      return
    }

    setSavingReply(true)
    try {
      const nextAnnotations = await postAnnotationComment(detail.id, replyDraft.annotationId, {
          authorType: 'user',
          authorLabel: '我的评论',
          content: replyDraft.content.trim(),
          status: 'ready',
        })
      setAnnotations(nextAnnotations)
      setFocusedAnnotationId(replyDraft.annotationId)
      setReplyDraft(null)
    } finally {
      setSavingReply(false)
    }
  }

  function handleEditStart(annotationId: string, commentId: string, content: string) {
    setReplyDraft(null)
    setEditDraft({ annotationId, commentId, content })
  }

  async function handleEditSubmit() {
    if (!detail || !editDraft || !editDraft.content.trim()) {
      return
    }

    setSavingEdit(true)
    try {
      const nextAnnotations = await patchAnnotationComment(detail.id, editDraft.annotationId, editDraft.commentId, {
          content: editDraft.content.trim(),
        })
      setAnnotations(nextAnnotations)
      setFocusedAnnotationId(editDraft.annotationId)
      setEditDraft(null)
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleArchiveToggle(annotationId: string, nextArchived: boolean) {
    if (!detail) {
      return
    }
    setAnnotations(await patchPaperAnnotation(detail.id, annotationId, { archived: nextArchived }))
    if (nextArchived && focusedAnnotationId === annotationId) {
      setFocusedAnnotationId(null)
    }
  }

  async function handleDeleteAnnotation(annotationId: string) {
    if (!detail) {
      return
    }
    setAnnotations(await deletePaperAnnotation(detail.id, annotationId))
    if (focusedAnnotationId === annotationId) {
      setFocusedAnnotationId(null)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0b0b0d] text-zinc-100">
        <div className="mx-auto flex min-h-screen max-w-[1600px] items-center justify-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-zinc-300">
            <RefreshCw className="h-4 w-4 animate-spin" />
            正在加载论文
          </div>
        </div>
      </main>
    )
  }

  if (!detail || error) {
    return (
      <main className="min-h-screen bg-[#0b0b0d] px-6 py-6 text-zinc-100">
        <div className="mx-auto max-w-[800px] rounded-[30px] border border-rose-400/20 bg-rose-400/10 p-8">
          <p className="text-sm text-rose-100">{error || '未找到该论文'}</p>
          <Link to="/" className="mt-6 inline-flex rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-100">
            返回列表
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0b0b0d] text-zinc-100">
      <button
        type="button"
        onClick={() => setOutlineOpen(true)}
        className="fixed left-4 top-4 z-40 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-4 py-2 text-sm text-zinc-100 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur transition hover:border-white/25 hover:bg-black/60 lg:left-6 lg:top-6"
      >
        <PanelLeft className="h-4 w-4" />
        目录
      </button>

      {outlineOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭目录"
            onClick={() => setOutlineOpen(false)}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
          />
          <aside className="fixed left-4 top-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col rounded-[28px] border border-white/10 bg-[#0f1014]/95 p-4 shadow-[0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur xl:left-6 xl:top-6 xl:bottom-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">目录</p>
                <h2 className="mt-1 font-serif text-xl text-zinc-100">章节导航</h2>
              </div>
              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="reader-scroll flex-1 overflow-y-auto pr-1">
              <OutlineNav outline={outline} activeId={activeSectionId} onJump={jumpToHeading} />
            </div>
          </aside>
        </>
      ) : null}

      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-6 py-6 lg:px-8">
        <header className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="space-y-3">
              <Link to="/" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-zinc-500 transition hover:text-zinc-200">
                <ArrowLeft className="h-3.5 w-3.5" />
                返回文献库
              </Link>
              <div>
                <h1 className="max-w-5xl text-balance font-serif text-3xl leading-tight text-zinc-50">{detail.title}</h1>
                <p className="mt-2 text-sm text-zinc-400">
                  {detail.taskId ? `任务 ${detail.taskId} · ` : ''}
                  更新于 {formatUpdatedAt(detail.updatedAt)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void postOpenAction(detail.id, 'rootDir')}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200 transition hover:border-white/30 hover:text-zinc-50"
              >
                <FolderOpen className="h-4 w-4" />
                打开目录
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {viewOptions
              .filter((item) => detail.availableViews.includes(item.key))
              .map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setView(item.key)}
                  className={[
                    'rounded-full px-4 py-2 text-sm transition',
                    item.key === activeView
                      ? 'border border-amber-300/40 bg-amber-300/12 text-amber-100'
                      : 'border border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:text-zinc-50',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
          </div>
        </header>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={articleShellRef} className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/8 px-6 py-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">正文视图</p>
              <h2 className="mt-1 font-serif text-xl text-zinc-100">
                {viewOptions.find((item) => item.key === activeView)?.label}
              </h2>
            </div>
            <div
              ref={articleRef}
              className="px-5 py-6 lg:px-8"
              onMouseUp={handleSelectionCapture}
              onKeyUp={handleSelectionCapture}
            >
              <div className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.28)] lg:px-10 lg:py-10">
                <MarkdownArticle markdown={markdown} paperId={detail.id} />
              </div>
            </div>
          </div>

          <CommentLane
            annotations={positionedAnnotations}
            activeView={activeView}
            laneHeight={laneHeight}
            draft={draft}
            savingDraft={savingDraft}
            replyDraft={replyDraft}
            savingReply={savingReply}
            editDraft={editDraft}
            savingEdit={savingEdit}
            onDraftChange={(value) => setDraft((current) => (current ? { ...current, content: value } : current))}
            onDraftCancel={() => setDraft(null)}
            onDraftSubmit={() => void handleDraftSubmit()}
            onSelectAnnotation={(annotationId) => setFocusedAnnotationId(annotationId)}
            onReplyStart={handleReplyStart}
            onReplyAgent={(annotationId) => void handleReplyAgent(annotationId)}
            onReplyChange={(value) => setReplyDraft((current) => (current ? { ...current, content: value } : current))}
            onReplyCancel={() => setReplyDraft(null)}
            onReplySubmit={() => void handleReplySubmit()}
            onEditStart={(annotationId, comment) => handleEditStart(annotationId, comment.id, comment.content)}
            onEditChange={(value) => setEditDraft((current) => (current ? { ...current, content: value } : current))}
            onEditCancel={() => setEditDraft(null)}
            onEditSubmit={() => void handleEditSubmit()}
            onArchiveToggle={(annotationId, nextArchived) => void handleArchiveToggle(annotationId, nextArchived)}
            onDeleteAnnotation={(annotationId) => void handleDeleteAnnotation(annotationId)}
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
          onAgent={() => void handleAgentSummon()}
        />
      ) : null}
    </main>
  )
}

interface SelectionToolbarState {
  view: PaperView
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop: number
  anchorHeight: number
  toolbarX: number
  toolbarY: number
}

function readSelection(
  articleContainer: HTMLDivElement | null,
  articleShell: HTMLDivElement | null,
  activeView: PaperView,
): SelectionToolbarState | null {
  if (!articleContainer || !articleShell) {
    return null
  }

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  const commonNode = range.commonAncestorContainer
  if (!articleContainer.contains(commonNode.nodeType === Node.TEXT_NODE ? commonNode.parentNode : commonNode)) {
    return null
  }

  const quote = selection.toString().replace(/\s+/g, ' ').trim()
  if (!quote) {
    return null
  }

  const rangeRect = range.getBoundingClientRect()
  if (!rangeRect.width && !rangeRect.height) {
    return null
  }

  const shellRect = articleShell.getBoundingClientRect()
  const anchorElement = findSelectionAnchorElement(commonNode, articleContainer)
  const anchorSource = normalizeWhitespace(anchorElement?.innerText || anchorElement?.textContent || quote)
  const normalizedQuote = normalizeWhitespace(quote)
  const quoteIndex = anchorSource.indexOf(normalizedQuote)
  return {
    view: activeView,
    quote: quote.slice(0, 600),
    contextBefore: quoteIndex >= 0 ? anchorSource.slice(Math.max(0, quoteIndex - 72), quoteIndex) : null,
    contextAfter:
      quoteIndex >= 0 ? anchorSource.slice(quoteIndex + normalizedQuote.length, quoteIndex + normalizedQuote.length + 72) : null,
    anchorTop: Math.max(rangeRect.top - shellRect.top, 0),
    anchorHeight: Math.max(rangeRect.height, 24),
    toolbarX: Math.max(220, Math.min(rangeRect.left + rangeRect.width / 2, window.innerWidth - 220)),
    toolbarY: Math.max(rangeRect.top - 12, 72),
  }
}

function clearBrowserSelection() {
  window.getSelection()?.removeAllRanges()
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function findSelectionAnchorElement(node: Node, articleContainer: HTMLElement) {
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node
  while (current && current instanceof HTMLElement) {
    if (current.hasAttribute('data-locator-node')) {
      return current
    }
    current = current.parentElement
  }

  return articleContainer.querySelector<HTMLElement>('[data-locator-node="true"]')
}

function buildAnnotationPayload(
  value: Pick<SelectionToolbarState, 'view' | 'quote' | 'contextBefore' | 'contextAfter' | 'anchorTop' | 'anchorHeight'>,
  initialComment: CreatePaperAnnotationInput['initialComment'],
): CreatePaperAnnotationInput {
  return {
    view: value.view,
    quote: value.quote,
    contextBefore: value.contextBefore ?? null,
    contextAfter: value.contextAfter ?? null,
    anchorTop: value.anchorTop,
    anchorHeight: value.anchorHeight,
    initialComment,
  }
}

async function upsertAnnotationComment(
  paperId: string,
  annotations: PaperAnnotation[],
  value: Pick<SelectionToolbarState, 'view' | 'quote' | 'contextBefore' | 'contextAfter' | 'anchorTop' | 'anchorHeight'>,
  initialComment: CreatePaperAnnotationInput['initialComment'],
) {
  const existingId = findExistingAnnotationId(annotations, value)
  if (existingId) {
    return postAnnotationComment(paperId, existingId, initialComment)
  }
  return postPaperAnnotation(paperId, buildAnnotationPayload(value, initialComment))
}

function clearFocusedAnnotation(container: HTMLElement) {
  container.querySelectorAll('.annotation-focus-active').forEach((element) => {
    element.classList.remove('annotation-focus-active')
  })
}

function clearInlineAnnotationMarkers(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-annotation-marked="true"]').forEach((element) => {
    element.classList.remove('annotation-inline-marked')
    element.removeAttribute('data-annotation-count')
    element.removeAttribute('data-annotation-marked')
  })
}

function findExistingAnnotationId(
  annotations: PaperAnnotation[],
  value: Pick<SelectionToolbarState, 'view' | 'quote' | 'contextBefore' | 'contextAfter'>,
) {
  const normalizedQuote = normalizeAnnotationText(value.quote)
  const normalizedBefore = normalizeAnnotationText(value.contextBefore ?? '')
  const normalizedAfter = normalizeAnnotationText(value.contextAfter ?? '')

  for (const annotation of annotations) {
    if (annotation.view !== value.view) {
      continue
    }
    if (normalizeAnnotationText(annotation.quote) !== normalizedQuote) {
      continue
    }

    const beforeMatches =
      !normalizedBefore || !annotation.contextBefore || normalizeAnnotationText(annotation.contextBefore).includes(normalizedBefore)
    const afterMatches =
      !normalizedAfter || !annotation.contextAfter || normalizeAnnotationText(annotation.contextAfter).includes(normalizedAfter)

    if (beforeMatches || afterMatches) {
      return annotation.id
    }
  }

  return null
}
