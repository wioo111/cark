// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchPaperMemory, postPaperNote } from '@/api'
import { PaperMemoryPanel } from '@/components/PaperMemoryPanel'
import type { PaperMemory } from '@/types'

vi.mock('@/api', () => ({
  fetchPaperMemory: vi.fn(),
  postPaperNote: vi.fn(),
}))

const memoryPayload: PaperMemory = {
  paperId: 'paper-1',
  title: 'Paper',
  summary: '核心判断',
  anchors: ['方法'],
  openQuestions: ['证据够不够'],
  recommendedActions: ['复查实验'],
  noteCount: 0,
  lastUpdated: '2026-06-17T00:00:00',
  recentNotes: [],
}

describe('PaperMemoryPanel', () => {
  beforeEach(() => {
    vi.mocked(fetchPaperMemory).mockResolvedValue(memoryPayload)
    vi.mocked(postPaperNote).mockResolvedValue({
      ...memoryPayload,
      noteCount: 1,
      recentNotes: [
        {
          id: 'note-1',
          paperId: 'paper-1',
          content: '一个判断',
          createdAt: '2026-06-17T00:00:00',
          updatedAt: '2026-06-17T00:00:00',
          quote: '关键句',
          tags: ['风险'],
        },
      ],
    })
  })

  it('loads memory and saves a seeded note', async () => {
    render(
      <PaperMemoryPanel
        open
        paperId="paper-1"
        paperTitle="Paper"
        seed={{ quote: '关键句', contextBefore: '前文', contextAfter: '后文' }}
        onClose={vi.fn()}
        onSeedConsumed={vi.fn()}
      />,
    )

    expect(await screen.findByText('核心判断')).toBeInTheDocument()
    expect((screen.getByLabelText('新笔记') as HTMLTextAreaElement).value).toContain('划线：关键句')

    fireEvent.change(screen.getByLabelText('标签'), { target: { value: '风险, 方法' } })
    fireEvent.click(screen.getByRole('button', { name: /保存笔记/ }))

    await waitFor(() => {
      expect(postPaperNote).toHaveBeenCalledWith('paper-1', {
        content: expect.stringContaining('划线：关键句'),
        quote: '关键句',
        tags: ['风险', '方法'],
      })
    })
    expect(await screen.findByText('一个判断')).toBeInTheDocument()
  })
})
