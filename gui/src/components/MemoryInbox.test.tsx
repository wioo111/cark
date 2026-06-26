// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import {
  fetchMemoryCandidates,
  postActivateMemoryCandidate,
  postArchiveMemoryCandidate,
} from '@/api'
import { MemoryInbox } from '@/components/MemoryInbox'

vi.mock('@/api', () => ({
  fetchMemoryCandidates: vi.fn(),
  postActivateMemoryCandidate: vi.fn(),
  postArchiveMemoryCandidate: vi.fn(),
}))

describe('MemoryInbox', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchMemoryCandidates).mockResolvedValue({
      count: 1,
      items: [
        {
          id: 'memory-1',
          layer: 'paper',
          paperId: 'paper-1',
          paperTitle: 'Paper One',
          memoryLayer: 'paper',
          type: 'insight',
          text: 'Candidate insight',
          content: 'Candidate insight',
          sourceAnnotationId: 'annotation-1',
          quote: 'Important evidence',
          evidence: [{ quote: 'Important evidence' }],
          locator: { annotationId: 'annotation-1' },
          anchor: null,
          tags: [],
          status: 'active',
          activationStatus: 'candidate',
          createdAt: '2026-06-25T00:00:00',
          updatedAt: '2026-06-25T00:00:00',
        },
      ],
    })
    vi.mocked(postActivateMemoryCandidate).mockResolvedValue({} as never)
    vi.mocked(postArchiveMemoryCandidate).mockResolvedValue({} as never)
  })

  it('loads and confirms memory candidates', async () => {
    const onChanged = vi.fn()
    render(
      <MemoryRouter>
        <MemoryInbox onChanged={onChanged} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Candidate insight')).toBeInTheDocument()
    expect(screen.getByText('Paper One')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开记忆来源' })).toHaveAttribute(
      'href',
      '/reader/paper-1?annotation=annotation-1&memory=memory-1',
    )

    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => {
      expect(postActivateMemoryCandidate).toHaveBeenCalledWith('memory-1')
      expect(onChanged).toHaveBeenCalled()
      expect(screen.queryByText('Candidate insight')).not.toBeInTheDocument()
    })
  })

  it('archives memory candidates', async () => {
    render(
      <MemoryRouter>
        <MemoryInbox />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Candidate insight')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '归档' }))

    await waitFor(() => {
      expect(postArchiveMemoryCandidate).toHaveBeenCalledWith('memory-1')
      expect(screen.queryByText('Candidate insight')).not.toBeInTheDocument()
    })
  })
})
