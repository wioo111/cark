import type { PaperAnnotation } from '@/types'

import type { AnnotationComposerDraft } from './CommentLane.types'

export const draftMeasurementKey = '__draft__'

export function estimateCardHeight(annotation: PaperAnnotation) {
  return Math.max(annotation.anchorHeight + 96, 138)
}

export function estimateDraftHeight(draft: AnnotationComposerDraft) {
  return Math.max(draft.anchorHeight + 148, 214)
}

export function areMeasuredHeightsEqual(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  return leftKeys.every((key) => left[key] === right[key])
}
