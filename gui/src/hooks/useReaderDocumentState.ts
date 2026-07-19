import { useEffect, useState } from 'react'

import {
  fetchPaperAnnotations,
  fetchPaperDetail,
  fetchReadingState,
  fetchSettings,
} from '@/api'
import type { AnnotationComposerDraft } from '@/components/CommentLane'
import type { AppSettings, PaperAnnotation, PaperDetail, PaperView } from '@/types'
import { normalizeDraftComposerState } from '@/utils/readerAnnotationHelpers'
import { preferNewestReadingState, readOfflineReadingState } from '@/utils/offlineReadingState'
import { isNativeOfflineMode } from '@/utils/apiBase'

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

interface UseReaderDocumentStateArgs {
  paperId: string
  rememberPaper: (paperId: string) => void
  setAnnotationError: React.Dispatch<React.SetStateAction<string | null>>
  setReadingStateError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useReaderDocumentState({
  paperId,
  rememberPaper,
  setAnnotationError,
  setReadingStateError,
}: UseReaderDocumentStateArgs) {
  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(createFallbackSettings)
  const [restoredView, setRestoredView] = useState<PaperView | null>(null)
  const [restoredDraft, setRestoredDraft] = useState<AnnotationComposerDraft | null>(null)
  const [restoredScrollY, setRestoredScrollY] = useState(0)
  const [readingStateLoaded, setReadingStateLoaded] = useState(false)

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

    fetchPaperDetail(paperId)
      .then(async (detailPayload) => {
        if (cancelled) {
          return
        }

        setDetail(detailPayload)

        const [annotationResult, readingStateResult, settingsResult] = await Promise.allSettled([
          fetchPaperAnnotations(paperId),
          fetchReadingState(paperId),
          isNativeOfflineMode() ? Promise.resolve(createFallbackSettings()) : fetchSettings(),
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

        const localReadingState = readOfflineReadingState(paperId)
        const readingState = preferNewestReadingState(
          readingStateResult.status === 'fulfilled' ? readingStateResult.value : null,
          localReadingState,
        )
        if (readingState) {
          setRestoredView(
            detailPayload.availableViews.includes(readingState.view)
              ? readingState.view
              : null,
          )
          setRestoredScrollY(readingState.scrollY)
          setRestoredDraft(normalizeDraftComposerState(readingState.draft ?? null))
        } else {
          const readingStateError = readingStateResult.status === 'rejected'
            ? readingStateResult.reason
            : null
          setReadingStateError(
            readingStateError instanceof Error
              ? `阅读进度加载失败：${readingStateError.message}`
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
  }, [paperId, setAnnotationError, setReadingStateError])

  useEffect(() => {
    document.title = detail ? `${detail.title} | cark` : 'cark'
  }, [detail])

  return {
    detail,
    setDetail,
    annotations,
    setAnnotations,
    loading,
    error,
    settings,
    restoredView,
    restoredDraft,
    restoredScrollY,
    readingStateLoaded,
  }
}
