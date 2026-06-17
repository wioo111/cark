// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UploadPanel } from '@/components/UploadPanel'

describe('UploadPanel', () => {
  it('passes multiple selected pdf files into the upload flow', () => {
    const onUpload = vi.fn()

    const { container } = render(
      <UploadPanel
        uploading={false}
        disabled={false}
        disabledReason={null}
        error={null}
        onUpload={onUpload}
        onOpenZotero={vi.fn()}
      />,
    )

    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()

    const first = new File(['first'], 'first.pdf', { type: 'application/pdf' })
    const second = new File(['second'], 'second.pdf', { type: 'application/pdf' })
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [first, second],
      },
    })

    expect(onUpload).toHaveBeenCalledWith([first, second])
    expect(screen.getByText('上传 PDF')).toBeInTheDocument()
    expect(screen.getByText(/一次选择多个文件/)).toBeInTheDocument()
  })
})
