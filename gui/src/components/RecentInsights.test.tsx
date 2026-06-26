// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { RecentInsights } from '@/components/RecentInsights'
import type { ResearchMemoryItem } from '@/types'

const insight: ResearchMemoryItem = {
  id: 'memory-1',
  layer: 'paper',
  paperId: 'paper-1',
  paperTitle: 'Paper One',
  memoryLayer: 'paper',
  type: 'insight',
  text: 'Confirmed insight',
  content: 'Confirmed insight',
  sourceAnnotationId: 'annotation-1',
  quote: 'Evidence quote',
  anchor: null,
  locator: { annotationId: 'annotation-1' },
  evidence: [{ quote: 'Evidence quote' }],
  tags: [],
  status: 'active',
  activationStatus: 'active',
  confidence: 0.9,
  createdAt: '2026-06-25T00:00:00',
  updatedAt: '2026-06-25T00:00:00',
}

describe('RecentInsights', () => {
  it('renders active insights with source links', () => {
    render(
      <MemoryRouter>
        <RecentInsights items={[insight]} count={1} loading={false} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Confirmed insight')).toBeInTheDocument()
    expect(screen.getByText('Paper One')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开判断来源' })).toHaveAttribute(
      'href',
      '/reader/paper-1?annotation=annotation-1&memory=memory-1',
    )
  })
})
