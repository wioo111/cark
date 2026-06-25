import { useEffect, useRef } from 'react'

import { saveReadingState } from '@/api'
import type { AnnotationComposerDraft } from '@/components/CommentLane'
import type { PaperDetail, PaperView } from '@/types'
import { createSaveScheduler, type SaveScheduler } from '@/utils/saveScheduler'

interface UseReaderReadingProgressArgs {
  detail: PaperDetail | null
  loading: boolean
  readingStateLoaded: boolean
  activeView: PaperView
  activeSectionId: string | null
  draft: AnnotationComposerDraft | null
  markdown: string
  restoredScrollY: number
  setReadingStateError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useReaderReadingProgress({
  detail,
  loading,
  readingStateLoaded,
  activeView,
  activeSectionId,
  draft,
  markdown,
  restoredScrollY,
  setReadingStateError,
}: UseReaderReadingProgressArgs) {
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
    latestReadingStateRef.current = {
      view: activeView,
      activeSectionId,
      draft,
    }
  }, [activeSectionId, activeView, draft])

  useEffect(() => {
    restoreCompleteRef.current = false
  }, [detail?.id])

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
  }, [detail, readingStateLoaded, setReadingStateError])

  useEffect(() => {
    if (!detail || loading || !readingStateLoaded || restoreCompleteRef.current) {
      return
    }

    let innerFrame = 0
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: restoredScrollY, behavior: 'auto' })
        restoreCompleteRef.current = true
      })
    })

    return () => {
      window.cancelAnimationFrame(outerFrame)
      window.cancelAnimationFrame(innerFrame)
    }
  }, [activeView, detail, loading, markdown, readingStateLoaded, restoredScrollY])

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
}
