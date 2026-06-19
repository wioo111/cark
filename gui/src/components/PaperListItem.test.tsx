// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaperListItem } from '@/components/PaperListItem'
import type { PaperSummary } from '@/types'

const basePaper: PaperSummary = {
  id: 'paper-1',
  title: 'A Paper',
  taskId: null,
  updatedAt: '2026-06-14T10:00:00',
  availableViews: ['linearized', 'bilingual'],
  hasImages: true,
  sourcePdf: null,
}

afterEach(() => {
  cleanup()
})

describe('PaperListItem', () => {
  it('keeps paper cards focused on title and reading action', () => {
    render(
      <MemoryRouter>
        <PaperListItem paper={basePaper} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'A Paper' })).toBeInTheDocument()
    expect(screen.getByText('阅读')).toBeInTheDocument()
    expect(screen.queryByText('结构化原文')).not.toBeInTheDocument()
    expect(screen.queryByText('中英双语')).not.toBeInTheDocument()
    expect(screen.queryByText('图片')).not.toBeInTheDocument()
    expect(screen.queryByText('可验双语')).not.toBeInTheDocument()
  })

  it('shows library metadata and exposes paper update controls', () => {
    const onFavoriteToggle = vi.fn()
    const onReadingStatusChange = vi.fn()
    const onTagsEdit = vi.fn()

    render(
      <MemoryRouter>
        <PaperListItem
          paper={{
            ...basePaper,
            favorite: true,
            readingStatus: 'reading',
            annotationCount: 2,
            memoryCount: 1,
            tags: ['认知', '方法'],
          }}
          onFavoriteToggle={onFavoriteToggle}
          onReadingStatusChange={onReadingStatusChange}
          onTagsEdit={onTagsEdit}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('收藏')).toBeInTheDocument()
    expect(screen.getAllByText('阅读中').length).toBeGreaterThan(0)
    expect(screen.getByText((_, element) => element?.textContent === '批注 2')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.textContent === '记忆 1')).toBeInTheDocument()
    expect(screen.getByText('认知')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Unfavorite paper'))
    expect(onFavoriteToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper-1' }))

    fireEvent.click(screen.getByLabelText('Edit paper tags'))
    expect(onTagsEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper-1' }))

    fireEvent.change(screen.getByLabelText('Paper reading status'), { target: { value: 'done' } })
    expect(onReadingStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper-1' }), 'done')
  })
})
