import { useEffect } from 'react'

import type { PaperAnnotation, StableLocator } from '@/types'
import { buildLocatorSearchParams } from '@/utils/stableLocator'

interface UseReaderRouteSyncArgs {
  annotations: PaperAnnotation[]
  activeView: string
  requestedAnnotationId: string | null
  requestedMemoryItemId: string | null
  requestedLocator: StableLocator | null
  setSearchParams: (
    nextInit:
      | URLSearchParams
      | ((prev: URLSearchParams) => URLSearchParams),
    navigateOptions?: { replace?: boolean },
  ) => void
  setFocusedAnnotationId: React.Dispatch<React.SetStateAction<string | null>>
  setMemoryOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function useReaderRouteSync({
  annotations,
  activeView,
  requestedAnnotationId,
  requestedMemoryItemId,
  requestedLocator,
  setSearchParams,
  setFocusedAnnotationId,
  setMemoryOpen,
}: UseReaderRouteSyncArgs) {
  useEffect(() => {
    if (!requestedAnnotationId || annotations.length === 0) {
      return
    }
    const target = annotations.find((annotation) => annotation.id === requestedAnnotationId)
    if (!target) {
      return
    }
    if (target.view !== activeView) {
      setSearchParams(
        buildLocatorSearchParams({
          ...(requestedLocator ?? {}),
          view: target.view,
          annotationId: target.id,
        }),
        { replace: true },
      )
      return
    }
    setFocusedAnnotationId(target.id)
  }, [activeView, annotations, requestedAnnotationId, requestedLocator, setFocusedAnnotationId, setSearchParams])

  useEffect(() => {
    if (requestedMemoryItemId) {
      setMemoryOpen(true)
    }
  }, [requestedMemoryItemId, setMemoryOpen])
}
