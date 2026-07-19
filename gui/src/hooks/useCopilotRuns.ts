import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchCopilotRuns,
  fetchPaperAnnotations,
  postCancelCopilotRun,
  postCopilotRun,
  postRetryCopilotRun,
} from '@/api'
import type { CopilotRun, CreateCopilotRunInput, PaperAnnotation } from '@/types'
import { isNativeOfflineMode } from '@/utils/apiBase'

interface UseCopilotRunsOptions {
  paperId: string | null
  onAnnotationsRefreshed: (annotations: PaperAnnotation[]) => void
  pollIntervalMs?: number
}

export function useCopilotRuns({
  paperId,
  onAnnotationsRefreshed,
  pollIntervalMs = 1800,
}: UseCopilotRunsOptions) {
  const [copilotRuns, setCopilotRuns] = useState<CopilotRun[]>([])
  const refreshedRunIdsRef = useRef<Set<string>>(new Set())
  const normalizedPaperId = paperId?.trim() || null

  useEffect(() => {
    refreshedRunIdsRef.current = new Set()
    setCopilotRuns([])
    if (!normalizedPaperId || isNativeOfflineMode()) {
      return
    }

    let cancelled = false
    fetchCopilotRuns(normalizedPaperId)
      .then((runs) => {
        if (!cancelled) {
          setCopilotRuns(runs)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCopilotRuns([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [normalizedPaperId])

  useEffect(() => {
    if (!normalizedPaperId || isNativeOfflineMode()) {
      return
    }
    let cancelled = false

    async function refreshRuns() {
      try {
        const nextRuns = await fetchCopilotRuns(normalizedPaperId)
        if (!cancelled) {
          setCopilotRuns(nextRuns)
        }
      } catch {
        // Keep the reader usable even if the transient status poll fails.
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshRuns()
    }, pollIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [normalizedPaperId, pollIntervalMs])

  useEffect(() => {
    if (!normalizedPaperId) {
      return
    }

    const completedRunIds = refreshedRunIdsRef.current
    let shouldRefreshAnnotations = false
    for (const run of copilotRuns) {
      if (!isTerminalCopilotRun(run.status) || completedRunIds.has(run.runId)) {
        continue
      }
      completedRunIds.add(run.runId)
      shouldRefreshAnnotations = true
    }
    if (!shouldRefreshAnnotations) {
      return
    }

    let cancelled = false
    fetchPaperAnnotations(normalizedPaperId)
      .then((nextAnnotations) => {
        if (!cancelled) {
          onAnnotationsRefreshed(nextAnnotations)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [copilotRuns, normalizedPaperId, onAnnotationsRefreshed])

  const activeAgentAnnotationIds = useMemo(
    () =>
      Array.from(
        new Set(
          copilotRuns
            .filter((run) => run.status === 'queued' || run.status === 'running')
            .map((run) => run.annotationId),
        ),
      ),
    [copilotRuns],
  )

  const startCopilotRun = useCallback(
    async (payload: CreateCopilotRunInput) => {
      if (!normalizedPaperId || payload.agentIds.length === 0) {
        return null
      }
      const run = await postCopilotRun(normalizedPaperId, payload)
      setCopilotRuns((current) => upsertCopilotRun(current, run))
      return run
    },
    [normalizedPaperId],
  )

  const cancelCopilotRun = useCallback(
    async (runId: string) => {
      if (!normalizedPaperId) {
        return null
      }
      const run = await postCancelCopilotRun(normalizedPaperId, runId)
      setCopilotRuns((current) => upsertCopilotRun(current, run))
      return run
    },
    [normalizedPaperId],
  )

  const retryCopilotRun = useCallback(
    async (runId: string, agentId?: string) => {
      if (!normalizedPaperId) {
        return null
      }
      const run = await postRetryCopilotRun(normalizedPaperId, runId, agentId)
      setCopilotRuns((current) => upsertCopilotRun(current, run))
      return run
    },
    [normalizedPaperId],
  )

  return {
    copilotRuns,
    activeAgentAnnotationIds,
    startCopilotRun,
    cancelCopilotRun,
    retryCopilotRun,
  }
}

function upsertCopilotRun(runs: CopilotRun[], nextRun: CopilotRun) {
  const replaced = runs.map((run) => (run.runId === nextRun.runId ? nextRun : run))
  if (replaced.some((run) => run.runId === nextRun.runId)) {
    return replaced
  }
  return [nextRun, ...runs]
}

function isTerminalCopilotRun(status: CopilotRun['status']) {
  return status === 'done' || status === 'failed' || status === 'canceled'
}
