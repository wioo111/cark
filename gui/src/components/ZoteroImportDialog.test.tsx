// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchZoteroPapers,
  fetchZoteroStatus,
  postImportZoteroPaper,
} from '@/api'
import { ZoteroImportDialog } from '@/components/ZoteroImportDialog'

vi.mock('@/api', () => ({
  fetchZoteroPapers: vi.fn(),
  fetchZoteroStatus: vi.fn(),
  postImportZoteroPaper: vi.fn(),
}))

describe('ZoteroImportDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('imports a Zotero PDF into the existing task flow', async () => {
    vi.mocked(fetchZoteroStatus).mockResolvedValue({
      available: true,
      version: '7.0',
      message: '已连接到 Zotero',
    })
    vi.mocked(fetchZoteroPapers).mockResolvedValue([
      {
        itemKey: 'ABCD1234',
        attachmentKey: 'PDFD1234',
        title: 'A Useful Paper',
        creators: ['Ada Lovelace'],
        year: '2024',
        fileName: 'paper.pdf',
        imported: false,
      },
    ])
    vi.mocked(postImportZoteroPaper).mockResolvedValue({
      id: 'task-zotero',
      fileName: 'paper.pdf',
      status: 'queued',
      stage: '等待执行',
      progress: 0,
      createdAt: '2026-06-14T16:30:00',
      updatedAt: '2026-06-14T16:30:00',
      logs: [],
    })
    const onImported = vi.fn()

    render(
      <ZoteroImportDialog
        open
        onClose={vi.fn()}
        onImported={onImported}
      />,
    )

    expect(await screen.findByText('A Useful Paper')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() => {
      expect(postImportZoteroPaper).toHaveBeenCalledWith('PDFD1234')
      expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-zotero' }))
      expect(screen.getByRole('button', { name: '已导入' })).toBeDisabled()
    })
  })

  it('explains that Zotero stays read only when unavailable', async () => {
    vi.mocked(fetchZoteroStatus).mockResolvedValue({
      available: false,
      version: null,
      message: '未检测到 Zotero。请先启动 Zotero 后重试。',
    })

    render(
      <ZoteroImportDialog
        open
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    )

    expect(await screen.findByText(/未检测到 Zotero/)).toBeInTheDocument()
    expect(screen.getByText(/不会修改 Zotero/)).toBeInTheDocument()
    expect(fetchZoteroPapers).not.toHaveBeenCalled()
  })
})
