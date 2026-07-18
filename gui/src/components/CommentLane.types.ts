import type { AnnotationComment, CopilotAgentConfig, CopilotRun, PaperAnnotation, PaperView } from '@/types'

export interface AnnotationComposerDraft {
  view: PaperView
  blockId?: string | null
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

export interface CommentLaneProps {
  annotations: PaperAnnotation[]
  activeView: PaperView
  focusCommentId?: string | null
  laneHeight: number
  agents: CopilotAgentConfig[]
  activeAgentAnnotationIds: string[]
  copilotRuns: CopilotRun[]
  memorySavingAnnotationIds: string[]
  memorySavedAnnotationIds: string[]
  memorySavingAgentCommentIds: string[]
  memorySavedAgentCommentIds: string[]
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
  onCancelCopilotRun: (runId: string) => void
  onRetryCopilotRun: (runId: string, agentId?: string) => void
  onEditStart: (annotationId: string, comment: AnnotationComment) => void
  onEditChange: (value: string) => void
  onEditCancel: () => void
  onEditSubmit: () => void
  onArchiveToggle: (annotationId: string, nextArchived: boolean) => void
  onDeleteAnnotation: (annotationId: string) => void
  onCreateMemoryFromAnnotation: (annotation: PaperAnnotation) => void
  onCreateMemoryFromAgentComment: (annotation: PaperAnnotation, comment: AnnotationComment) => void
}
