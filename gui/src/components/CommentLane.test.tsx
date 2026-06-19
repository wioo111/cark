// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentLane } from '@/components/CommentLane'
import type { PaperAnnotation } from '@/types'

const annotation: PaperAnnotation = {
  id: 'annotation-1',
  paperId: 'paper-1',
  view: 'linearized',
  quote: 'Important quote',
  contextBefore: 'Before',
  contextAfter: 'After',
  anchorTop: 12,
  anchorHeight: 24,
  createdAt: '2026-06-17T00:00:00',
  updatedAt: '2026-06-17T00:00:00',
  archived: false,
  archivedAt: null,
  comments: [
    {
      id: 'comment-1',
      authorType: 'user',
      authorLabel: 'Me',
      content: 'This becomes a memory.',
      preview: 'This becomes a memory.',
      createdAt: '2026-06-17T00:00:00',
      updatedAt: '2026-06-17T00:00:00',
      status: 'ready',
    },
  ],
}

describe('CommentLane', () => {
  afterEach(() => {
    cleanup()
  })

  it('creates memory from an annotation without selecting the card', () => {
    const onCreateMemoryFromAnnotation = vi.fn()
    const onSelectAnnotation = vi.fn()

    render(
      <CommentLane
        annotations={[annotation]}
        activeView="linearized"
        laneHeight={420}
        agents={[]}
        activeAgentAnnotationIds={[]}
        copilotRuns={[]}
        memorySavingAnnotationIds={[]}
        memorySavedAnnotationIds={[]}
        draft={null}
        savingDraft={false}
        replyDraft={null}
        savingReply={false}
        editDraft={null}
        savingEdit={false}
        onDraftChange={vi.fn()}
        onDraftCancel={vi.fn()}
        onDraftSubmit={vi.fn()}
        onDraftAgentToggle={vi.fn()}
        onSelectAnnotation={onSelectAnnotation}
        onReplyStart={vi.fn()}
        onReplyChange={vi.fn()}
        onReplyCancel={vi.fn()}
        onReplySubmit={vi.fn()}
        onReplyAgentToggle={vi.fn()}
        onCancelCopilotRun={vi.fn()}
        onRetryCopilotRun={vi.fn()}
        onEditStart={vi.fn()}
        onEditChange={vi.fn()}
        onEditCancel={vi.fn()}
        onEditSubmit={vi.fn()}
        onArchiveToggle={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onCreateMemoryFromAnnotation={onCreateMemoryFromAnnotation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create memory from annotation' }))

    expect(onCreateMemoryFromAnnotation).toHaveBeenCalledWith(annotation)
    expect(onSelectAnnotation).not.toHaveBeenCalled()
  })

  it('shows memory save feedback states', () => {
    const { rerender } = render(
      <CommentLane
        annotations={[annotation]}
        activeView="linearized"
        laneHeight={420}
        agents={[]}
        activeAgentAnnotationIds={[]}
        copilotRuns={[]}
        memorySavingAnnotationIds={['annotation-1']}
        memorySavedAnnotationIds={[]}
        draft={null}
        savingDraft={false}
        replyDraft={null}
        savingReply={false}
        editDraft={null}
        savingEdit={false}
        onDraftChange={vi.fn()}
        onDraftCancel={vi.fn()}
        onDraftSubmit={vi.fn()}
        onDraftAgentToggle={vi.fn()}
        onSelectAnnotation={vi.fn()}
        onReplyStart={vi.fn()}
        onReplyChange={vi.fn()}
        onReplyCancel={vi.fn()}
        onReplySubmit={vi.fn()}
        onReplyAgentToggle={vi.fn()}
        onCancelCopilotRun={vi.fn()}
        onRetryCopilotRun={vi.fn()}
        onEditStart={vi.fn()}
        onEditChange={vi.fn()}
        onEditCancel={vi.fn()}
        onEditSubmit={vi.fn()}
        onArchiveToggle={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onCreateMemoryFromAnnotation={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Create memory from annotation' })).toBeDisabled()
    expect(screen.getByText('沉淀中')).toBeInTheDocument()

    rerender(
      <CommentLane
        annotations={[annotation]}
        activeView="linearized"
        laneHeight={420}
        agents={[]}
        activeAgentAnnotationIds={[]}
        copilotRuns={[]}
        memorySavingAnnotationIds={[]}
        memorySavedAnnotationIds={['annotation-1']}
        draft={null}
        savingDraft={false}
        replyDraft={null}
        savingReply={false}
        editDraft={null}
        savingEdit={false}
        onDraftChange={vi.fn()}
        onDraftCancel={vi.fn()}
        onDraftSubmit={vi.fn()}
        onDraftAgentToggle={vi.fn()}
        onSelectAnnotation={vi.fn()}
        onReplyStart={vi.fn()}
        onReplyChange={vi.fn()}
        onReplyCancel={vi.fn()}
        onReplySubmit={vi.fn()}
        onReplyAgentToggle={vi.fn()}
        onCancelCopilotRun={vi.fn()}
        onRetryCopilotRun={vi.fn()}
        onEditStart={vi.fn()}
        onEditChange={vi.fn()}
        onEditCancel={vi.fn()}
        onEditSubmit={vi.fn()}
        onArchiveToggle={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onCreateMemoryFromAnnotation={vi.fn()}
      />,
    )

    expect(screen.getByText('已沉淀')).toBeInTheDocument()
  })

  it('shows copilot run status with cancel and per-agent retry actions', () => {
    const onCancelCopilotRun = vi.fn()
    const onRetryCopilotRun = vi.fn()

    render(
      <CommentLane
        annotations={[annotation]}
        activeView="linearized"
        laneHeight={420}
        agents={[]}
        activeAgentAnnotationIds={['annotation-1']}
        copilotRuns={[
          {
            runId: 'run-1',
            paperId: 'paper-1',
            annotationId: 'annotation-1',
            status: 'running',
            userMessage: 'Explain this',
            agents: [
              {
                agentId: 'agent-a',
                agentName: 'Method Agent',
                status: 'running',
              },
            ],
            results: [],
            errors: [],
            createdAt: '2026-06-17T00:00:00',
            updatedAt: '2026-06-17T00:00:00',
            attempt: 1,
          },
          {
            runId: 'run-2',
            paperId: 'paper-1',
            annotationId: 'annotation-1',
            status: 'failed',
            userMessage: 'Explain this',
            agents: [
              {
                agentId: 'agent-b',
                agentName: 'Theory Agent',
                status: 'failed',
                error: 'model timeout',
              },
            ],
            results: [],
            errors: [],
            createdAt: '2026-06-17T00:00:00',
            updatedAt: '2026-06-17T00:00:00',
            attempt: 1,
          },
        ]}
        memorySavingAnnotationIds={[]}
        memorySavedAnnotationIds={[]}
        draft={null}
        savingDraft={false}
        replyDraft={null}
        savingReply={false}
        editDraft={null}
        savingEdit={false}
        onDraftChange={vi.fn()}
        onDraftCancel={vi.fn()}
        onDraftSubmit={vi.fn()}
        onDraftAgentToggle={vi.fn()}
        onSelectAnnotation={vi.fn()}
        onReplyStart={vi.fn()}
        onReplyChange={vi.fn()}
        onReplyCancel={vi.fn()}
        onReplySubmit={vi.fn()}
        onReplyAgentToggle={vi.fn()}
        onCancelCopilotRun={onCancelCopilotRun}
        onRetryCopilotRun={onRetryCopilotRun}
        onEditStart={vi.fn()}
        onEditChange={vi.fn()}
        onEditCancel={vi.fn()}
        onEditSubmit={vi.fn()}
        onArchiveToggle={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onCreateMemoryFromAnnotation={vi.fn()}
      />,
    )

    expect(screen.getAllByText('共读助手运行中').length).toBeGreaterThan(0)
    expect(screen.getByText('model timeout')).toBeInTheDocument()

    fireEvent.click(screen.getByText('取消'))
    expect(onCancelCopilotRun).toHaveBeenCalledWith('run-1')

    fireEvent.click(screen.getByText('重试'))
    expect(onRetryCopilotRun).toHaveBeenCalledWith('run-2', 'agent-b')
  })
})
