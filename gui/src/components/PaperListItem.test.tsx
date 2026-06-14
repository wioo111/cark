// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { PaperListItem } from '@/components/PaperListItem'

describe('PaperListItem', () => {
  it('keeps paper cards focused on title and reading action', () => {
    render(
      <MemoryRouter>
        <PaperListItem
          paper={{
            id: 'paper-1',
            title: 'A Paper',
            taskId: null,
            updatedAt: '2026-06-14T10:00:00',
            availableViews: ['linearized', 'bilingual'],
            hasImages: true,
            sourcePdf: null,
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'A Paper' })).toBeInTheDocument()
    expect(screen.getByText('阅读')).toBeInTheDocument()
    expect(screen.queryByText('结构化原文')).not.toBeInTheDocument()
    expect(screen.queryByText('中英双语')).not.toBeInTheDocument()
    expect(screen.queryByText('图片')).not.toBeInTheDocument()
    expect(screen.queryByText('可验双语')).not.toBeInTheDocument()
  })
})
