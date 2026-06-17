import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, BookMarked, FolderOpen, PanelLeft, RefreshCw, X } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import {
  deletePaperAnnotation,
  fetchPaperAnnotations,
  fetchPaperDetail,
  fetchReadingState,
  fetchSettings,
  patchAnnotationComment,
  patchPaperAnnotation,
  postAnnotationAgentComment,
  postAnnotationComment,
  postOpenAction,
  postPaperAnnotation,
  saveReadingState,
} from '@/api'
import {
  type AnnotationComposerDraft,
  type AnnotationEditDraft,
  type AnnotationReplyDraft,
  type AnnotationReplyTarget,
  CommentLane,
} from '@/components/CommentLane'
import { MarkdownArticle } from '@/components/MarkdownArticle'
import { OutlineNav } from '@/components/OutlineNav'
import type { MemoryNoteSeed } from '@/components/PaperMemoryPanel'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { AppSettings, CreatePaperAnnotationInput, PaperAnnotation, PaperDetail, PaperView } from '@/types'
import { normalizeAnnotationText, resolveAnnotationHighlight } from '@/utils/annotationLocator'
import { scrollToArticleSection } from '@/utils/markdown'
import {
  cleanBilingualMarkdown,
  extractBilingualOutline,
  extractOutline,
  formatUpdatedAt,
  resolvePaperView,
} from '@/utils/paper'
import { createSaveScheduler, type SaveScheduler } from '@/utils/saveScheduler'

const viewOptions: Array<{ key: PaperView; label: string }> = [
  { key: 'linearized', label: '原文' },
  { key: 'bilingual', label: '译文版本' },
]

const PaperMemoryPanel = lazy(async () => {
  const module = await import('@/components/PaperMemoryPanel')
  return { default: module.PaperMemoryPanel }
})

function createFallbackSettings(): AppSettings {
  return {
    mineru: {
      backend: 'local',
      modelVersion: 'pipeline',
      parseMethod: 'auto',
      apiToken: '',
      reuseExistingParse: true,
    },
    translation: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      failRatioLimit: 0.2,
    },
    publish: {
      prepareOnly: true,
      imageMode: 'note',
      folderToken: '',
      appId: '',
      appSecret: '',
    },
    copilot: {
      agents: [],
    },
  }
}

export default function ReaderPage() {
  const { paperId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const rememberPaper = useWorkspaceStore((state) => state.rememberPaper)
  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [readingStateError, setReadingStateError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(createFallbackSettings)
  const [restoredView, setRestoredView] = useState<PaperView | null>(null)
  const [readingStateLoaded, setReadingStateLoaded] = useState(false)
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
  const [agentRunCounts, setAgentRunCounts] = useState<Record<string, number>>({})
  const [positionedAnnotations, setPositionedAnnotations] = useState<PaperAnnotation[]>([])
  const [annotationHighlights, setAnnotationHighlights] = useState<
    Array<{ annotationId: string; rects: Array<{ top: number; left: number; width: number; height: number }> }>
  >([])
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null)
  const [flashAnnotationId, setFlashAnnotationId] = useState<string | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memorySeed, setMemorySeed] = useState<MemoryNoteSeed | null>(null)
  const articleShellRef = useRef<HTMLDivElement | null>(null)
  const articleRef = useRef<HTMLDivElement | null>(null)
  const restoredScrollRef = useRef(0)
  const restoreCompleteRef = useRef(false)
  const readingSaveSchedulerRef = useRef<SaveScheduler | null>(null)
  const readingRevisionRef = useRef(Date.now() * 1000)
  const latestReadingStateRef = useRef<{
    view: PaperView
    activeSectionId: string | null
    draft: AnnotationComposerDraft | null
  }>({
    view: 'linearized',
    activeSectionId: null,
    draft: null,
  })

  useEffect(() => {
    rememberPaper(paperId)
  }, [paperId, rememberPaper])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAnnotationError(null)
    setReadingStateError(null)
    setReadingStateLoaded(false)
    restoreCompleteRef.current = false
    restoredScrollRef.current = 0

    fetchPaperDetail(paperId)
      .then(async (detailPayload) => {
        if (cancelled) {
          return
        }

        setDetail(detailPayload)

        const [annotationResult, readingStateResult, settingsResult] = await Promise.allSettled([
          fetchPaperAnnotations(paperId),
          fetchReadingState(paperId),
          fetchSettings(),
        ])
        if (cancelled) {
          return
        }

        if (annotationResult.status === 'fulfilled') {
          setAnnotations(annotationResult.value)
        } else {
          setAnnotations([])
          setAnnotationError(
            annotationResult.reason instanceof Error
              ? `批注加载失败：${annotationResult.reason.message}`
              : '批注加载失败',
          )
        }

        if (readingStateResult.status === 'fulfilled') {
          const readingState = readingStateResult.value
          setRestoredView(
            detailPayload.availableViews.includes(readingState.view)
              ? readingState.view
              : null,
          )
          restoredScrollRef.current = readingState.scrollY
          readingRevisionRef.current = Math.max(
            readingRevisionRef.current,
            readingState.clientRevision ?? 0,
          )
          setDraft(normalizeDraftComposerState(readingState.draft ?? null))
        } else {
          setReadingStateError(
            readingStateResult.reason instanceof Error
              ? `阅读进度加载失败：${readingStateResult.reason.message}`
              : '阅读进度加载失败',
          )
        }
        if (settingsResult.status === 'fulfilled') {
          setSettings(settingsResult.value)
        }
        setReadingStateLoaded(true)
        setLoading(false)
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

  const requestedView = searchParams.get('view') as PaperView | null
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
  const activeAgentAnnotationIds = useMemo(
    () => Object.entries(agentRunCounts).filter(([, count]) => count > 0).map(([annotationId]) => annotationId),
    [agentRunCounts],
  )

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
    latestReadingStateRef.current = {
      view: activeView,
      activeSectionId,
      draft,
    }
  }, [activeSectionId, activeView, draft])

  useEffect(() => {
    if (!detail || !readingStateLoaded) {
      return
    }
    const scheduler = createSaveScheduler(async (keepalive) => {
      const snapshot = latestReadingStateRef.current
      readingRevisionRef.current = Math.max(
        readingRevisionRef.current + 1,
        Date.now() * 1000,
      )
      try {
        await saveReadingState(
          detail.id,
          {
            view: snapshot.view,
            scrollY: window.scrollY,
            clientRevision: readingRevisionRef.current,
            activeSectionId: snapshot.activeSectionId,
            draft: snapshot.draft,
          },
          { keepalive },
        )
      } catch (saveError) {
        if (!keepalive) {
          setReadingStateError(
            saveError instanceof Error
              ? `阅读进度保存失败：${saveError.message}`
              : '阅读进度保存失败',
          )
        }
      }
    })
    readingSaveSchedulerRef.current = scheduler

    const flushBeforeLeave = () => {
      void scheduler.flush(true)
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushBeforeLeave()
      }
    }
    window.addEventListener('pagehide', flushBeforeLeave)
    document.addEventListener('visibilitychange', flushWhenHidden)

    return () => {
      window.removeEventListener('pagehide', flushBeforeLeave)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      if (readingSaveSchedulerRef.current === scheduler) {
        readingSaveSchedulerRef.current = null
      }
      void scheduler.dispose()
    }
  }, [detail, readingStateLoaded])

  useEffect(() => {
    if (!detail || loading || !readingStateLoaded || restoreCompleteRef.current) {
      return
    }

    let innerFrame = 0
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: restoredScrollRef.current, behavior: 'auto' })
        restoreCompleteRef.current = true
      })
    })

    return () => {
      window.cancelAnimationFrame(outerFrame)
      window.cancelAnimationFrame(innerFrame)
    }
  }, [activeView, detail, loading, markdown, readingStateLoaded])

  useEffect(() => {
    if (!detail || !readingStateLoaded || !restoreCompleteRef.current) {
      return
    }
    readingSaveSchedulerRef.current?.schedule(350)
  }, [activeSectionId, activeView, detail, draft, readingStateLoaded])

  useEffect(() => {
    if (!detail || !readingStateLoaded) {
      return
    }
    const handleScroll = () => {
      if (!restoreCompleteRef.current) {
        return
      }
      readingSaveSchedulerRef.current?.schedule(300)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [detail, readingStateLoaded])

  useEffect(() => {
    const container = articleRef.current
    if (!container) {
      return
    }

    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    headings.forEach((element, index) => {
      if (!element.id) {
        element.setAttribute('id', outline[index]?.id ?? `section-${index + 1}`)
      }
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
      setAnnotationHighlights([])
      return
    }

    let animationFrame = 0
    const recompute = () => {
      const nextHighlights: Array<{ annotationId: string; rects: Array<{ top: number; left: number; width: number; height: number }> }> = []
      const nextAnnotations = annotations.map((annotation) => {
          if (annotation.view !== activeView) {
            return annotation
          }
          const resolved = resolveAnnotationHighlight(articleContainer, articleShell, annotation)
          if (!resolved) {
            return annotation
          }
          if (!annotation.archived) {
            nextHighlights.push({ annotationId: annotation.id, rects: resolved.rects })
          }
          return { ...annotation, anchorTop: resolved.top, anchorHeight: resolved.height }
        })
      setPositionedAnnotations(nextAnnotations)
      setAnnotationHighlights(nextHighlights)
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
    const articleShell = articleShellRef.current
    const targetHighlight = annotationHighlights.find((annotation) => annotation.annotationId === focusedAnnotationId)
    if (!articleShell || !focusedAnnotationId || !targetHighlight) {
      return
    }

    const targetAnnotation = positionedAnnotations.find((annotation) => annotation.id === focusedAnnotationId)
    if (!targetAnnotation || targetAnnotation.view !== activeView) {
      return
    }

    const shellRect = articleShell.getBoundingClientRect()
    const absoluteTop = window.scrollY + shellRect.top + Math.max(targetAnnotation.anchorTop - 140, 0)
    window.scrollTo({ top: absoluteTop, behavior: 'auto' })
    setFlashAnnotationId(focusedAnnotationId)

    const timeout = window.setTimeout(() => {
      setFlashAnnotationId((current) => (current === focusedAnnotationId ? null : current))
    }, 2200)

    return () => {
      window.clearTimeout(timeout)
      setFlashAnnotationId((current) => (current === focusedAnnotationId ? null : current))
    }
  }, [activeView, annotationHighlights, focusedAnnotationId, positionedAnnotations])

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
    setAnnotationError(null)
    setDraft({
      view: toolbarSelection.view,
      quote: toolbarSelection.quote,
      contextBefore: toolbarSelection.contextBefore,
      contextAfter: toolbarSelection.contextAfter,
      anchorTop: toolbarSelection.anchorTop,
      anchorHeight: toolbarSelection.anchorHeight,
      content: '',
      mentionAgentIds: [],
    })
    clearBrowserSelection()
    setToolbarSelection(null)
  }

  function handleNoteStart() {
    if (!toolbarSelection) {
      return
    }
    setMemorySeed({
      quote: toolbarSelection.quote,
      contextBefore: toolbarSelection.contextBefore,
      contextAfter: toolbarSelection.contextAfter,
    })
    setMemoryOpen(true)
    clearBrowserSelection()
    setToolbarSelection(null)
  }

  async function handleDraftSubmit() {
    if (!detail || !draft || !draft.content.trim()) {
      return
    }

    const draftSnapshot = draft
    const userMessage = draft.content.trim()
    setSavingDraft(true)
    setAnnotationError(null)
    try {
      const nextAnnotations = await upsertAnnotationComment(detail.id, annotations, draftSnapshot, {
          authorType: 'user',
          authorLabel: '我的评论',
          content: userMessage,
          status: 'ready',
        })
      const annotationId = findExistingAnnotationId(nextAnnotations, draftSnapshot)
      setAnnotations(nextAnnotations)
      setFocusedAnnotationId(annotationId)
      setDraft(null)
      clearBrowserSelection()
      setSavingDraft(false)

      if (annotationId && draftSnapshot.mentionAgentIds.length > 0) {
        void invokeMentionedAgents(
          detail.id,
          annotationId,
          draftSnapshot.mentionAgentIds,
          userMessage,
          nextAnnotations,
        ).catch((agentError) => {
          setAnnotationError(formatAnnotationError('智能体回复失败', agentError))
        })
      }
    } catch (saveError) {
      setAnnotationError(formatAnnotationError('保存批注失败', saveError))
      setSavingDraft(false)
    }
  }

  function handleReplyStart(annotationId: string, target?: AnnotationReplyTarget) {
    setAnnotationError(null)
    setEditDraft(null)
    setReplyDraft({
      annotationId,
      content: '',
      mentionAgentIds: target?.agentId ? [target.agentId] : [],
      followUpCommentId: target?.commentId ?? null,
      followUpAgentId: target?.agentId ?? null,
      followUpAgentLabel: target?.agentLabel ?? null,
      followUpPreview: target?.commentPreview ?? null,
    })
  }

  async function handleReplySubmit() {
    if (!detail || !replyDraft || !replyDraft.content.trim()) {
      return
    }

    const replySnapshot = replyDraft
    const userMessage = replyDraft.content.trim()
    setSavingReply(true)
    setAnnotationError(null)
    try {
      const nextAnnotations = await postAnnotationComment(detail.id, replySnapshot.annotationId, {
          authorType: 'user',
          authorLabel: '我的评论',
          replyToCommentId: replySnapshot.followUpCommentId ?? undefined,
          replyToAgentId: replySnapshot.followUpAgentId ?? undefined,
          content: userMessage,
          status: 'ready',
        })
      setAnnotations(nextAnnotations)
      setFocusedAnnotationId(replySnapshot.annotationId)
      setReplyDraft(null)
      setSavingReply(false)

      if (replySnapshot.mentionAgentIds.length > 0) {
        void invokeMentionedAgents(
          detail.id,
          replySnapshot.annotationId,
          replySnapshot.mentionAgentIds,
          userMessage,
          nextAnnotations,
          replySnapshot.followUpCommentId ?? undefined,
          replySnapshot.followUpAgentId ?? undefined,
        ).catch((agentError) => {
          setAnnotationError(formatAnnotationError('智能体回复失败', agentError))
        })
      }
    } catch (saveError) {
      setAnnotationError(formatAnnotationError('追加评论失败', saveError))
      setSavingReply(false)
    }
  }

  function handleDraftAgentToggle(agentId: string) {
    setDraft((current) => {
      if (!current) {
        return current
      }
      const mentioned = current.mentionAgentIds.includes(agentId)
      return {
        ...current,
        mentionAgentIds: mentioned
          ? current.mentionAgentIds.filter((id) => id !== agentId)
          : [...current.mentionAgentIds, agentId],
      }
    })
  }

  function handleReplyAgentToggle(agentId: string) {
    setReplyDraft((current) => {
      if (!current) {
        return current
      }
      const mentioned = current.mentionAgentIds.includes(agentId)
      return {
        ...current,
        mentionAgentIds: mentioned
          ? current.mentionAgentIds.filter((id) => id !== agentId)
          : [...current.mentionAgentIds, agentId],
      }
    })
  }

  function handleEditStart(annotationId: string, commentId: string, content: string) {
    setAnnotationError(null)
    setReplyDraft(null)
    setEditDraft({ annotationId, commentId, content })
  }

  async function handleEditSubmit() {
    if (!detail || !editDraft || !editDraft.content.trim()) {
      return
    }

    setSavingEdit(true)
    setAnnotationError(null)
    try {
      const nextAnnotations = await patchAnnotationComment(detail.id, editDraft.annotationId, editDraft.commentId, {
          content: editDraft.content.trim(),
        })
      setAnnotations(nextAnnotations)
      setFocusedAnnotationId(editDraft.annotationId)
      setEditDraft(null)
    } catch (saveError) {
      setAnnotationError(formatAnnotationError('保存修改失败', saveError))
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleArchiveToggle(annotationId: string, nextArchived: boolean) {
    if (!detail) {
      return
    }
    setAnnotationError(null)
    try {
      setAnnotations(await patchPaperAnnotation(detail.id, annotationId, { archived: nextArchived }))
      if (nextArchived && focusedAnnotationId === annotationId) {
        setFocusedAnnotationId(null)
      }
    } catch (saveError) {
      setAnnotationError(formatAnnotationError(nextArchived ? '归档批注失败' : '还原批注失败', saveError))
    }
  }

  async function handleDeleteAnnotation(annotationId: string) {
    if (!detail) {
      return
    }
    if (!window.confirm('删除这条批注及其中的所有评论？此操作无法撤销。')) {
      return
    }
    setAnnotationError(null)
    try {
      setAnnotations(await deletePaperAnnotation(detail.id, annotationId))
      if (focusedAnnotationId === annotationId) {
        setFocusedAnnotationId(null)
      }
    } catch (deleteError) {
      setAnnotationError(formatAnnotationError('删除批注失败', deleteError))
    }
  }

  async function invokeMentionedAgents(
    paperIdValue: string,
    annotationId: string,
    agentIds: string[],
    userMessage: string,
    initialAnnotations: PaperAnnotation[],
    followUpCommentId?: string,
    followUpAgentId?: string,
  ) {
    if (agentIds.length === 0) {
      return initialAnnotations
    }

    let nextAnnotations = initialAnnotations
    updateAgentRunCount(annotationId, 1)
    try {
      for (const agentId of agentIds) {
        nextAnnotations = await postAnnotationAgentComment(paperIdValue, {
          agentId,
          annotationId,
          userMessage,
          followUpCommentId: !followUpCommentId || !followUpAgentId || followUpAgentId === agentId ? followUpCommentId : undefined,
        })
        setAnnotations(nextAnnotations)
        setFocusedAnnotationId(annotationId)
      }
    } finally {
      updateAgentRunCount(annotationId, -1)
    }
    return nextAnnotations
  }

  function updateAgentRunCount(annotationId: string, delta: number) {
    setAgentRunCounts((current) => {
      const nextCount = Math.max((current[annotationId] ?? 0) + delta, 0)
      if (nextCount === 0) {
        const { [annotationId]: _removed, ...rest } = current
        return rest
      }
      return {
        ...current,
        [annotationId]: nextCount,
      }
    })
  }

  if (loading) {
    return (
      <main className="cark-page min-h-screen">
        <div className="mx-auto flex min-h-screen max-w-[1600px] items-center justify-center">
          <div className="cark-panel cark-text inline-flex items-center gap-3 rounded-full px-5 py-3 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin" />
            正在加载论文
          </div>
        </div>
      </main>
    )
  }

  if (!detail || error) {
    return (
      <main className="cark-page min-h-screen px-6 py-6">
        <div className="mx-auto max-w-[800px] rounded-[30px] border border-rose-400/20 bg-rose-400/10 p-8">
          <p className="text-sm text-rose-100">{error || '未找到该论文'}</p>
          <Link to="/" className="cark-button-secondary mt-6 inline-flex rounded-full px-4 py-2 text-sm">
            返回列表
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="cark-page min-h-screen">
      <Link
        to="/"
        className="cark-panel cark-elevated fixed bottom-5 left-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm backdrop-blur transition hover:border-[rgba(var(--accent-rgb),0.28)] xl:left-8"
      >
        <ArrowLeft className="h-4 w-4" />
        返回文献库
      </Link>

      <button
        type="button"
        onClick={() => setOutlineOpen(true)}
        className="cark-panel cark-elevated fixed left-0 top-1/2 z-40 inline-flex h-14 w-12 -translate-y-1/2 items-center justify-center rounded-r-[18px] border-l-0 backdrop-blur transition hover:w-14 hover:border-[rgba(var(--accent-rgb),0.28)] xl:h-16 xl:w-14"
        aria-label="打开目录"
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      {annotationError || readingStateError ? (
        <div className="fixed right-4 top-4 z-[70] flex max-w-[460px] items-start gap-3 rounded-[20px] border border-rose-400/25 bg-[#2a1115]/95 px-4 py-3 text-sm text-rose-100 shadow-[0_20px_70px_rgba(0,0,0,0.4)] backdrop-blur">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            {annotationError ? <p>{annotationError}</p> : null}
            {readingStateError ? <p>{readingStateError}</p> : null}
          </div>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => {
              setAnnotationError(null)
              setReadingStateError(null)
            }}
            className="ml-auto text-rose-200/70 transition hover:text-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {outlineOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭目录"
            onClick={() => setOutlineOpen(false)}
            className="cark-overlay fixed inset-0 z-40 backdrop-blur-[2px]"
          />
          <aside className="cark-panel cark-elevated fixed bottom-4 left-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col rounded-[28px] p-4 backdrop-blur xl:bottom-6 xl:left-6 xl:top-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="cark-faint text-xs uppercase tracking-[0.22em]">目录</p>
                <h2 className="cark-title mt-1 font-serif text-xl">章节导航</h2>
              </div>
              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
                className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
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
        <header className="cark-theme-header rounded-[32px] px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="space-y-3">
              <div>
                <h1 className="cark-title max-w-5xl text-balance font-serif text-3xl leading-tight">{detail.title}</h1>
                <p className="cark-muted mt-2 text-sm">
                  {detail.taskId ? `任务 ${detail.taskId} · ` : ''}
                  更新于 {formatUpdatedAt(detail.updatedAt)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <ThemeSwitch />
              <button
                type="button"
                onClick={() => void postOpenAction(detail.id, 'rootDir')}
                className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
              >
                <FolderOpen className="h-4 w-4" />
                打开目录
              </button>
              <button
                type="button"
                onClick={() => setMemoryOpen(true)}
                className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
              >
                <BookMarked className="h-4 w-4" />
                论文记忆
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
                      ? 'cark-button-accent'
                      : 'cark-button-secondary bg-[var(--surface-input)]',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
          </div>
        </header>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={articleShellRef} className="cark-panel relative overflow-hidden rounded-[28px]">
            <div className="border-b px-6 py-4 [border-color:var(--border-soft)]">
              <p className="cark-faint text-xs uppercase tracking-[0.22em]">正文视图</p>
              <h2 className="cark-title mt-1 font-serif text-xl">
                {viewOptions.find((item) => item.key === activeView)?.label}
              </h2>
            </div>
            <div className="pointer-events-none absolute inset-0 z-10">
              {annotationHighlights
                .filter((item) => positionedAnnotations.find((annotation) => annotation.id === item.annotationId)?.view === activeView)
                .flatMap((item) =>
                  item.rects.map((rect, index) => (
                    <div
                      key={`${item.annotationId}-${index}`}
                      className={[
                        'absolute rounded-full transition-all',
                        item.annotationId === flashAnnotationId
                          ? 'bg-[rgba(var(--accent-rgb),0.85)] shadow-[0_0_18px_rgba(var(--accent-rgb),0.35)]'
                          : 'bg-[rgba(var(--accent-rgb),0.58)]',
                      ].join(' ')}
                      style={{
                        top: `${rect.top + Math.max(rect.height - (item.annotationId === flashAnnotationId ? 4 : 3), 0)}px`,
                        left: `${rect.left}px`,
                        width: `${rect.width}px`,
                        height: `${item.annotationId === flashAnnotationId ? 3 : 2}px`,
                      }}
                    />
                  )),
                )}
            </div>
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
            laneHeight={laneHeight}
            agents={availableAgents}
            activeAgentAnnotationIds={activeAgentAnnotationIds}
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
          onNote={handleNoteStart}
        />
      ) : null}

      {memoryOpen ? (
        <Suspense fallback={null}>
          <PaperMemoryPanel
            open={memoryOpen}
            paperId={detail.id}
            paperTitle={detail.title}
            seed={memorySeed}
            onClose={() => setMemoryOpen(false)}
            onSeedConsumed={() => setMemorySeed(null)}
          />
        </Suspense>
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
  const contextWindow = Math.min(Math.max(quote.length < 120 ? 36 : 52, 24), 52)
  return {
    view: activeView,
    quote: quote.slice(0, 600),
    contextBefore: quoteIndex >= 0 ? anchorSource.slice(Math.max(0, quoteIndex - contextWindow), quoteIndex) : null,
    contextAfter:
      quoteIndex >= 0
        ? anchorSource.slice(
            quoteIndex + normalizedQuote.length,
            quoteIndex + normalizedQuote.length + contextWindow,
          )
        : null,
    anchorTop: Math.max(rangeRect.top - shellRect.top, 0),
    anchorHeight: Math.max(rangeRect.height, 24),
    toolbarX: Math.max(220, Math.min(rangeRect.left + rangeRect.width / 2, window.innerWidth - 220)),
    toolbarY: Math.max(rangeRect.top - 12, 72),
  }
}

function clearBrowserSelection() {
  window.getSelection()?.removeAllRanges()
}

function normalizeDraftComposerState(
  draft:
    | AnnotationComposerDraft
    | (Omit<AnnotationComposerDraft, 'mentionAgentIds'> & { mentionAgentIds?: string[] })
    | null,
) {
  if (!draft) {
    return null
  }
  return {
    ...draft,
    mentionAgentIds: draft.mentionAgentIds ?? [],
  }
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

  const fallback = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  return fallback instanceof HTMLElement && articleContainer.contains(fallback) ? fallback : null
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

function formatAnnotationError(prefix: string, error: unknown) {
  return error instanceof Error ? `${prefix}：${error.message}` : prefix
}
