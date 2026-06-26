// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { patchPaperMemoryItem } from '@/api'
import { OpenQuestions } from '@/components/OpenQuestions'
import type { ResearchMemoryItem } from '@/types'

vi.mock('@/api', () => ({
  patchPaperMemoryItem: vi.fn(),
}))

const question: ResearchMemoryItem = {
  id: 'memory-question',
  layer: 'paper',
  paperId: 'paper-1',
  paperTitle: 'Paper One',
  memoryLayer: 'paper',
  type: 'question',
  text: 'Open question?',
  content: 'Open question?',
  sourceAnnotationId: 'annotation-1',
  quote: 'Evidence quote',
  anchor: null,
  locator: { annotationId: 'annotation-1', memoryItemId: 'memory-question' },
  evidence: [{ quote: 'Evidence quote' }],
  tags: [],
  status: 'active',
  activationStatus: 'active',
  confidence: 0.8,
  createdAt: '2026-06-25T00:00:00',
  updatedAt: '2026-06-25T00:00:00',
}

describe('OpenQuestions', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(patchPaperMemoryItem).mockResolvedValue({} as never)
  })

  it('marks questions done', async () => {
    const onChanged = vi.fn()
    render(
      <MemoryRouter>
        <OpenQuestions items={[question]} count={1} loading={false} onRefresh={vi.fn()} onChanged={onChanged} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '已解决' }))

    await waitFor(() => {
      expect(patchPaperMemoryItem).toHaveBeenCalledWith('paper-1', 'memory-question', { status: 'done' })
      expect(onChanged).toHaveBeenCalled()
    })
  })

  it('archives questions', async () => {
    render(
      <MemoryRouter>
        <OpenQuestions items={[question]} count={1} loading={false} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '归档' }))

    await waitFor(() => {
      expect(patchPaperMemoryItem).toHaveBeenCalledWith('paper-1', 'memory-question', {
        status: 'archived',
        activationStatus: 'archived',
      })
    })
  })
})
