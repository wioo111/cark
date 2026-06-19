// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deletePaperMemoryItem,
  fetchPaperMemory,
  patchPaperMemoryItem,
  postPaperMemoryItem,
  postPaperMemoryMarkdownExport,
} from '@/api'
import { PaperMemoryPanel } from '@/components/PaperMemoryPanel'
import type { PaperMemory, PaperMemoryItem } from '@/types'

vi.mock('@/api', () => ({
  deletePaperMemoryItem: vi.fn(),
  fetchPaperMemory: vi.fn(),
  patchPaperMemoryItem: vi.fn(),
  postPaperMemoryItem: vi.fn(),
  postPaperMemoryMarkdownExport: vi.fn(),
}))

const scrollIntoViewMock = vi.fn()
const createObjectUrlMock = vi.fn(() => 'blob:memory-export')
const revokeObjectUrlMock = vi.fn()
const anchorClickMock = vi.fn()

const noteItem: PaperMemoryItem = {
  id: 'memory-1',
  paperId: 'paper-1',
  type: 'note',
  text: 'A durable judgment',
  content: 'A durable judgment',
  sourceAnnotationId: null,
  quote: 'Important quote',
  anchor: null,
  createdAt: '2026-06-17T00:00:00',
  updatedAt: '2026-06-17T00:00:00',
  blockId: null,
  blockPreview: null,
  tags: ['risk'],
  status: 'active',
}

const memoryPayload: PaperMemory = {
  paperId: 'paper-1',
  title: 'Paper',
  summary: 'Core judgment',
  anchors: ['method'],
  openQuestions: ['What evidence is missing?'],
  recommendedActions: ['Re-check the experiment'],
  noteCount: 1,
  lastUpdated: '2026-06-17T00:00:00',
  items: [noteItem],
  notes: [noteItem],
  questions: [],
  actions: [],
  insights: [],
  recentNotes: [noteItem],
}

describe('PaperMemoryPanel', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    })
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrlMock,
    })
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrlMock,
    })
    Object.defineProperty(window.HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: anchorClickMock,
    })
    scrollIntoViewMock.mockClear()
    createObjectUrlMock.mockClear()
    revokeObjectUrlMock.mockClear()
    anchorClickMock.mockClear()
    vi.mocked(fetchPaperMemory).mockResolvedValue(memoryPayload)
    vi.mocked(postPaperMemoryItem).mockResolvedValue(memoryPayload)
    vi.mocked(postPaperMemoryMarkdownExport).mockResolvedValue({
      paperId: 'paper-1',
      title: 'Paper',
      format: 'markdown',
      fileName: 'paper-memory.md',
      filePath: 'runtime/memory/papers/paper-1/exports/paper-memory.md',
      markdown: '# Paper\n\nA durable judgment\n',
      createdAt: '2026-06-18T00:00:00',
      itemCount: 1,
    })
    vi.mocked(patchPaperMemoryItem).mockResolvedValue({
      ...memoryPayload,
      recentNotes: [
        {
          ...noteItem,
          text: 'Updated judgment',
          content: 'Updated judgment',
        },
      ],
    })
    vi.mocked(deletePaperMemoryItem).mockResolvedValue({
      ...memoryPayload,
      noteCount: 0,
      items: [],
      notes: [],
      recentNotes: [],
    })
  })

  it('scrolls to a focused memory item', async () => {
    render(
      <PaperMemoryPanel
        open
        paperId="paper-1"
        paperTitle="Paper"
        seed={null}
        focusItemId="memory-1"
        onClose={vi.fn()}
        onSeedConsumed={vi.fn()}
      />,
    )

    expect(await screen.findByText('Core judgment')).toBeInTheDocument()

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    })
    expect(document.querySelector('[data-memory-item-id="memory-1"]')).not.toBeNull()
  })

  it('emits locate action for a memory item', async () => {
    const onLocateItem = vi.fn()
    render(
      <PaperMemoryPanel
        open
        paperId="paper-1"
        paperTitle="Paper"
        seed={null}
        onClose={vi.fn()}
        onSeedConsumed={vi.fn()}
        onLocateItem={onLocateItem}
      />,
    )

    expect(await screen.findByText('Core judgment')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '定位原文' }))

    expect(onLocateItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'memory-1' }))
  })

  it('loads memory and saves a seeded note', async () => {
    render(
      <PaperMemoryPanel
        open
        paperId="paper-1"
        paperTitle="Paper"
        seed={{ quote: 'Important quote', contextBefore: 'Before', contextAfter: 'After' }}
        onClose={vi.fn()}
        onSeedConsumed={vi.fn()}
      />,
    )

    expect(await screen.findByText('Core judgment')).toBeInTheDocument()
    expect(screen.getByText('记忆分组')).toBeInTheDocument()
    expect(screen.getByText('笔记')).toBeInTheDocument()
    expect((screen.getByLabelText('New memory text') as HTMLTextAreaElement).value).toContain('Important quote')

    fireEvent.change(screen.getByLabelText('New memory tags'), { target: { value: 'risk, method' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new memory' }))

    await waitFor(() => {
      expect(postPaperMemoryItem).toHaveBeenCalledWith('paper-1', {
        type: 'note',
        text: expect.stringContaining('Important quote'),
        quote: 'Important quote',
        tags: ['risk', 'method'],
      })
    })
  })

  it('exports paper memory as a markdown download', async () => {
    render(
      <PaperMemoryPanel
        open
        paperId="paper-1"
        paperTitle="Paper"
        seed={null}
        onClose={vi.fn()}
        onSeedConsumed={vi.fn()}
      />,
    )

    expect(await screen.findByText('Core judgment')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export memory Markdown' }))

    await waitFor(() => {
      expect(postPaperMemoryMarkdownExport).toHaveBeenCalledWith('paper-1')
      expect(createObjectUrlMock).toHaveBeenCalled()
      expect(anchorClickMock).toHaveBeenCalled()
      expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:memory-export')
      expect(screen.getByText('已导出 1 条记忆')).toBeInTheDocument()
    })
  })

  it('edits and deletes memory items', async () => {
    render(
      <PaperMemoryPanel
        open
        paperId="paper-1"
        paperTitle="Paper"
        seed={null}
        onClose={vi.fn()}
        onSeedConsumed={vi.fn()}
      />,
    )

    expect((await screen.findAllByText('A durable judgment')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Edit memory' }))
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Updated judgment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(patchPaperMemoryItem).toHaveBeenCalledWith('paper-1', 'memory-1', {
        type: 'note',
        text: 'Updated judgment',
        tags: ['risk'],
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete memory' }))

    await waitFor(() => {
      expect(deletePaperMemoryItem).toHaveBeenCalledWith('paper-1', 'memory-1')
    })
  })
})
