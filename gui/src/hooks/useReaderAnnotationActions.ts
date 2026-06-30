import { useMemo, useState } from 'react'

import {
  deletePaperAnnotation,
  patchAnnotationComment,
  patchPaperAnnotation,
  postAnnotationComment,
  postAnnotationMemoryCandidates,
  postAnnotationMemoryItem,
} from '@/api'
import type {
  AnnotationComposerDraft,
  AnnotationEditDraft,
  AnnotationReplyDraft,
  AnnotationReplyTarget,
} from '@/components/CommentLane'
import type { AnnotationComment, CopilotRunMode, CreateCopilotRunInput, PaperAnnotation, PaperDetail } from '@/types'
import {
  buildMemoryTextFromAgentComment,
  buildMemoryTextFromAnnotation,
  findExistingAnnotationId,
  formatAnnotationError,
  inferMemoryItemType,
  upsertAnnotationComment,
} from '@/utils/readerAnnotationHelpers'
import { clearBrowserSelection, type SelectionToolbarState } from '@/utils/readerSelection'

interface UseReaderAnnotationActionsArgs {
  detail: PaperDetail | null
  annotations: PaperAnnotation[]
  toolbarSelection: SelectionToolbarState | null
  setAnnotations: React.Dispatch<React.SetStateAction<PaperAnnotation[]>>
  setToolbarSelection: React.Dispatch<React.SetStateAction<SelectionToolbarState | null>>
  setAnnotationError: React.Dispatch<React.SetStateAction<string | null>>
  setFocusedAnnotationId: React.Dispatch<React.SetStateAction<string | null>>
  setMemoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMemoryRefreshKey: React.Dispatch<React.SetStateAction<number>>
  agentIdsForQuickActions: string[]
  startCopilotRun: (payload: CreateCopilotRunInput) => Promise<unknown>
  cancelCopilotRun: (runId: string) => Promise<unknown>
  retryCopilotRun: (runId: string, agentId?: string) => Promise<unknown>
}

export function useReaderAnnotationActions({
  detail,
  annotations,
  toolbarSelection,
  setAnnotations,
  setToolbarSelection,
  setAnnotationError,
  setFocusedAnnotationId,
  setMemoryOpen,
  setMemoryRefreshKey,
  agentIdsForQuickActions,
  startCopilotRun,
  cancelCopilotRun,
  retryCopilotRun,
}: UseReaderAnnotationActionsArgs) {
  const [draft, setDraft] = useState<AnnotationComposerDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [replyDraft, setReplyDraft] = useState<AnnotationReplyDraft | null>(null)
  const [savingReply, setSavingReply] = useState(false)
  const [editDraft, setEditDraft] = useState<AnnotationEditDraft | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [memorySaveCounts, setMemorySaveCounts] = useState<Record<string, number>>({})
  const [memorySavedAnnotationIds, setMemorySavedAnnotationIds] = useState<string[]>([])
  const [agentMemorySaveCounts, setAgentMemorySaveCounts] = useState<Record<string, number>>({})
  const [memorySavedAgentCommentIds, setMemorySavedAgentCommentIds] = useState<string[]>([])
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null)

  const memorySavingAnnotationIds = useMemo(
    () => Object.entries(memorySaveCounts).filter(([, count]) => count > 0).map(([annotationId]) => annotationId),
    [memorySaveCounts],
  )
  const memorySavingAgentCommentIds = useMemo(
    () => Object.entries(agentMemorySaveCounts).filter(([, count]) => count > 0).map(([commentId]) => commentId),
    [agentMemorySaveCounts],
  )

  function handleDraftStart() {
    if (!toolbarSelection) {
      return
    }
    setAnnotationError(null)
    setDraft({
      view: toolbarSelection.view,
      blockId: toolbarSelection.blockId,
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

  async function handleSelectionAgentAction(runMode: CopilotRunMode) {
    if (!detail || !toolbarSelection) {
      return
    }
    const agentId = agentIdsForQuickActions[0]
    if (!agentId) {
      setAnnotationError('请先在设置里配置可用的共读助手')
      return
    }

    const selectionSnapshot = toolbarSelection
    const userMessage = buildSelectionAgentPrompt(runMode)
    const quickDraft = {
      view: selectionSnapshot.view,
      blockId: selectionSnapshot.blockId,
      quote: selectionSnapshot.quote,
      contextBefore: selectionSnapshot.contextBefore,
      contextAfter: selectionSnapshot.contextAfter,
      anchorTop: selectionSnapshot.anchorTop,
      anchorHeight: selectionSnapshot.anchorHeight,
      content: userMessage,
      mentionAgentIds: [],
    }
    setAnnotationError(null)
    setToolbarSelection(null)
    clearBrowserSelection()
    try {
      const nextAnnotations = await upsertAnnotationComment(detail.id, annotations, quickDraft, {
        authorType: 'user',
        authorLabel: '我的评论',
        content: userMessage,
        status: 'ready',
      })
      const annotationId = findExistingAnnotationId(nextAnnotations, quickDraft)
      setAnnotations(nextAnnotations)
      if (!annotationId) {
        throw new Error('创建批注后未找到对应线程')
      }
      setFocusedAnnotationId(annotationId)
      await startCopilotRun({
        annotationId,
        agentIds: [agentId],
        runMode,
        userMessage,
      })
      if (runMode === 'memory_candidate') {
        setMemoryOpen(true)
      }
    } catch (error) {
      setAnnotationError(formatAnnotationError('启动共读动作失败', error))
    }
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
        void invokeMentionedAgents(annotationId, draftSnapshot.mentionAgentIds, userMessage, nextAnnotations).catch((agentError) => {
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
      if (nextArchived) {
        setFocusedAnnotationId((current) => (current === annotationId ? null : current))
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
      setFocusedAnnotationId((current) => (current === annotationId ? null : current))
    } catch (deleteError) {
      setAnnotationError(formatAnnotationError('删除批注失败', deleteError))
    }
  }

  async function handleCreateMemoryFromAnnotation(annotation: PaperAnnotation) {
    if (!detail || (memorySaveCounts[annotation.id] ?? 0) > 0) {
      return
    }

    const text = buildMemoryTextFromAnnotation(annotation)
    if (!text) {
      setAnnotationError('这条批注没有可沉淀的内容')
      return
    }

    updateMemorySaveCount(annotation.id, 1)
    setAnnotationError(null)
    try {
      await postAnnotationMemoryItem(detail.id, annotation.id, {
        type: inferMemoryItemType(text),
        text,
        quote: annotation.quote,
        tags: ['annotation'],
        activationStatus: 'candidate',
        confidence: 0.72,
      })
      setMemoryRefreshKey((current) => current + 1)
      setMemoryOpen(true)
      setMemoryNotice('已生成候选记忆，待确认')
      setMemorySavedAnnotationIds((current) => (current.includes(annotation.id) ? current : [...current, annotation.id]))
      window.setTimeout(() => {
        setMemorySavedAnnotationIds((current) => current.filter((id) => id !== annotation.id))
        setMemoryNotice(null)
      }, 2600)
    } catch (saveError) {
      setAnnotationError(formatAnnotationError('沉淀到论文记忆失败', saveError))
    } finally {
      updateMemorySaveCount(annotation.id, -1)
    }
  }

  async function handleCreateMemoryFromAgentComment(annotation: PaperAnnotation, comment: AnnotationComment) {
    if (!detail || (agentMemorySaveCounts[comment.id] ?? 0) > 0) {
      return
    }

    const text = buildMemoryTextFromAgentComment(comment)
    if (!text) {
      setAnnotationError('这条共读回复没有可沉淀的内容')
      return
    }

    updateAgentMemorySaveCount(comment.id, 1)
    setAnnotationError(null)
    try {
      const payload = await postAnnotationMemoryCandidates(detail.id, annotation.id, {
        sourceCommentId: comment.id,
        agentId: comment.agentId ?? null,
        runMode: comment.runMode,
        items: [
          {
            type: inferMemoryItemType(text),
            text,
            tags: ['agent', 'agent_comment'],
            confidence: 0.72,
            evidenceQuote: annotation.quote,
          },
        ],
      })
      const createdIds = payload.created.map((item) => item.id)
      updateAgentCommentMemoryState(annotation.id, comment.id, createdIds)
      setMemoryRefreshKey((current) => current + 1)
      setMemoryOpen(true)
      setMemoryNotice('已从共读回复生成候选记忆，待确认')
      setMemorySavedAgentCommentIds((current) => (current.includes(comment.id) ? current : [...current, comment.id]))
      window.setTimeout(() => {
        setMemorySavedAgentCommentIds((current) => current.filter((id) => id !== comment.id))
        setMemoryNotice(null)
      }, 2600)
    } catch (saveError) {
      setAnnotationError(formatAnnotationError('从共读回复沉淀候选记忆失败', saveError))
    } finally {
      updateAgentMemorySaveCount(comment.id, -1)
    }
  }

  async function handleCancelCopilotRun(runId: string) {
    try {
      await cancelCopilotRun(runId)
    } catch (cancelError) {
      setAnnotationError(formatAnnotationError('取消共读任务失败', cancelError))
    }
  }

  async function handleRetryCopilotRun(runId: string, agentId?: string) {
    try {
      await retryCopilotRun(runId, agentId)
    } catch (retryError) {
      setAnnotationError(formatAnnotationError('重试共读任务失败', retryError))
    }
  }

  async function invokeMentionedAgents(
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

    await startCopilotRun({
      annotationId,
      agentIds,
      userMessage,
      followUpCommentId,
      followUpAgentId,
    })
    setFocusedAnnotationId(annotationId)
    return initialAnnotations
  }

  function updateMemorySaveCount(annotationId: string, delta: number) {
    setMemorySaveCounts((current) => {
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

  function updateAgentMemorySaveCount(commentId: string, delta: number) {
    setAgentMemorySaveCounts((current) => {
      const nextCount = Math.max((current[commentId] ?? 0) + delta, 0)
      if (nextCount === 0) {
        const { [commentId]: _removed, ...rest } = current
        return rest
      }
      return {
        ...current,
        [commentId]: nextCount,
      }
    })
  }

  function updateAgentCommentMemoryState(annotationId: string, commentId: string, createdIds: string[]) {
    if (createdIds.length === 0) {
      return
    }
    setAnnotations((current) =>
      current.map((annotation) => {
        if (annotation.id !== annotationId) {
          return annotation
        }
        return {
          ...annotation,
          comments: annotation.comments.map((comment) => {
            if (comment.id !== commentId) {
              return comment
            }
            const existingIds = Array.isArray(comment.memoryCandidateIds) ? comment.memoryCandidateIds : []
            const nextIds = [...existingIds, ...createdIds.filter((id) => !existingIds.includes(id))]
            return {
              ...comment,
              memoryCandidateIds: nextIds,
              memoryCandidateCount: Math.max(comment.memoryCandidateCount ?? 0, nextIds.length),
            }
          }),
        }
      }),
    )
  }

  return {
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
  }
}

function buildSelectionAgentPrompt(runMode: CopilotRunMode) {
  if (runMode === 'explain') {
    return '请解释这句话在全文中的作用。'
  }
  if (runMode === 'critique') {
    return '请指出这句话的问题、限制或可能反例。'
  }
  if (runMode === 'memory_candidate') {
    return '请将这句话沉淀为可审核的研究记忆候选项。'
  }
  return '请围绕这句话给出具体判断。'
}
