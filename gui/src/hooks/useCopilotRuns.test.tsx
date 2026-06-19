// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchCopilotRuns,
  fetchPaperAnnotations,
  postCancelCopilotRun,
  postCopilotRun,
  postRetryCopilotRun,
} from '@/api'
import { useCopilotRuns } from '@/hooks/useCopilotRuns'
import type { CopilotRun, PaperAnnotation } from '@/types'

vi.mock('@/api', () => ({
  fetchCopilotRuns: vi.fn(),
  fetchPaperAnnotations: vi.fn(),
  postCancelCopilotRun: vi.fn(),
  postCopilotRun: vi.fn(),
  postRetryCopilotRun: vi.fn(),
}))

function makeRun(overrides: Partial<CopilotRun> = {}): CopilotRun {
  return {
    runId: 'run-1',
    paperId: 'paper-1',
    annotationId: 'annotation-1',
    agents: [
      {
        agentId: 'agent-1',
        agentName: 'Agent',
        status: 'queued',
        resultCommentId: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    ],
    status: 'queued',
    userMessage: '',
    followUpCommentId: null,
    followUpAgentId: null,
    results: [],
    errors: [],
    createdAt: '2026-06-18T00:00:00',
    updatedAt: '2026-06-18T00:00:00',
    startedAt: null,
    finishedAt: null,
    attempt: 1,
    ...overrides,
  }
}

function makeAnnotation(): PaperAnnotation {
  return {
    id: 'annotation-1',
    paperId: 'paper-1',
    view: 'linearized',
    quote: 'Quote',
    contextBefore: null,
    contextAfter: null,
    anchorTop: 0,
    anchorHeight: 24,
    createdAt: '2026-06-18T00:00:00',
    updatedAt: '2026-06-18T00:00:00',
    archived: false,
    archivedAt: null,
    comments: [],
  }
}

function Harness({ onAnnotationsRefreshed = vi.fn() }: { onAnnotationsRefreshed?: (items: PaperAnnotation[]) => void }) {
  const {
    copilotRuns,
    activeAgentAnnotationIds,
    startCopilotRun,
    cancelCopilotRun,
    retryCopilotRun,
  } = useCopilotRuns({
    paperId: 'paper-1',
    onAnnotationsRefreshed,
    pollIntervalMs: 60_000,
  })

  return (
    <div>
      <span data-testid="run-count">{copilotRuns.length}</span>
      <span data-testid="active-annotations">{activeAgentAnnotationIds.join(',')}</span>
      <button
        type="button"
        onClick={() =>
          void startCopilotRun({
            annotationId: 'annotation-1',
            agentIds: ['agent-1'],
            userMessage: 'Read this.',
          })
        }
      >
        Start
      </button>
      <button type="button" onClick={() => void cancelCopilotRun('run-1')}>
        Cancel
      </button>
      <button type="button" onClick={() => void retryCopilotRun('run-1', 'agent-1')}>
        Retry
      </button>
    </div>
  )
}

describe('useCopilotRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchCopilotRuns).mockResolvedValue([])
    vi.mocked(fetchPaperAnnotations).mockResolvedValue([makeAnnotation()])
    vi.mocked(postCopilotRun).mockResolvedValue(makeRun())
    vi.mocked(postCancelCopilotRun).mockResolvedValue(makeRun({ status: 'canceled' }))
    vi.mocked(postRetryCopilotRun).mockResolvedValue(makeRun({ runId: 'run-retry', status: 'queued' }))
  })

  it('starts, cancels, and retries copilot runs', async () => {
    render(<Harness />)

    await waitFor(() => {
      expect(fetchCopilotRuns).toHaveBeenCalledWith('paper-1')
    })

    screen.getByRole('button', { name: 'Start' }).click()
    await waitFor(() => {
      expect(postCopilotRun).toHaveBeenCalledWith('paper-1', {
        annotationId: 'annotation-1',
        agentIds: ['agent-1'],
        userMessage: 'Read this.',
      })
      expect(screen.getByTestId('run-count')).toHaveTextContent('1')
      expect(screen.getByTestId('active-annotations')).toHaveTextContent('annotation-1')
    })

    screen.getByRole('button', { name: 'Cancel' }).click()
    await waitFor(() => {
      expect(postCancelCopilotRun).toHaveBeenCalledWith('paper-1', 'run-1')
    })

    screen.getByRole('button', { name: 'Retry' }).click()
    await waitFor(() => {
      expect(postRetryCopilotRun).toHaveBeenCalledWith('paper-1', 'run-1', 'agent-1')
    })
  })

  it('refreshes annotations once when a run reaches a terminal state', async () => {
    const onAnnotationsRefreshed = vi.fn()
    vi.mocked(fetchCopilotRuns).mockResolvedValue([makeRun({ status: 'done' })])

    render(<Harness onAnnotationsRefreshed={onAnnotationsRefreshed} />)

    await waitFor(() => {
      expect(fetchPaperAnnotations).toHaveBeenCalledWith('paper-1')
      expect(onAnnotationsRefreshed).toHaveBeenCalledWith([makeAnnotation()])
    })
  })
})
