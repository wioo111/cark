import {
  postAnnotationComment,
  postPaperAnnotation,
} from '@/api'
import type { AnnotationComposerDraft } from '@/components/CommentLane'
import type { CreatePaperAnnotationInput, MemoryItemType, PaperAnnotation } from '@/types'

import { normalizeAnnotationText } from '@/utils/annotationLocator'

export function normalizeDraftComposerState(
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

export async function upsertAnnotationComment(
  paperId: string,
  annotations: PaperAnnotation[],
  value: Pick<
    AnnotationComposerDraft,
    'view' | 'blockId' | 'quote' | 'contextBefore' | 'contextAfter' | 'anchorTop' | 'anchorHeight'
  >,
  initialComment: CreatePaperAnnotationInput['initialComment'],
) {
  const existingId = findExistingAnnotationId(annotations, value)
  if (existingId) {
    return postAnnotationComment(paperId, existingId, initialComment)
  }
  return postPaperAnnotation(paperId, buildAnnotationPayload(value, initialComment))
}

export function findExistingAnnotationId(
  annotations: PaperAnnotation[],
  value: Pick<AnnotationComposerDraft, 'view' | 'quote' | 'contextBefore' | 'contextAfter'>,
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

export function buildMemoryTextFromAnnotation(annotation: PaperAnnotation) {
  const userComments = annotation.comments
    .filter((comment) => comment.authorType === 'user')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const latestUserComment = userComments.at(-1)
  const commentText = latestUserComment?.content.trim()
  if (commentText) {
    return commentText
  }
  return annotation.quote.trim()
}

export function inferMemoryItemType(text: string): MemoryItemType {
  return /[?？]\s*$/.test(text.trim()) ? 'question' : 'insight'
}

export function formatAnnotationError(prefix: string, error: unknown) {
  return error instanceof Error ? `${prefix}：${error.message}` : prefix
}

function buildAnnotationPayload(
  value: Pick<
    AnnotationComposerDraft,
    'view' | 'blockId' | 'quote' | 'contextBefore' | 'contextAfter' | 'anchorTop' | 'anchorHeight'
  >,
  initialComment: CreatePaperAnnotationInput['initialComment'],
): CreatePaperAnnotationInput {
  return {
    view: value.view,
    blockId: value.blockId ?? null,
    quote: value.quote,
    contextBefore: value.contextBefore ?? null,
    contextAfter: value.contextAfter ?? null,
    anchorTop: value.anchorTop,
    anchorHeight: value.anchorHeight,
    initialComment,
  }
}
