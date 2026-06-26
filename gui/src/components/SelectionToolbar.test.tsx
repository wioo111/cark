// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SelectionToolbar } from '@/components/SelectionToolbar'

describe('SelectionToolbar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders fixed agent actions', () => {
    const onExplain = vi.fn()
    const onCritique = vi.fn()
    const onMemoryCandidate = vi.fn()

    render(
      <SelectionToolbar
        x={120}
        y={80}
        onCopy={vi.fn()}
        onSearch={vi.fn()}
        onComment={vi.fn()}
        onExplain={onExplain}
        onCritique={onCritique}
        onMemoryCandidate={onMemoryCandidate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '解释' }))
    fireEvent.click(screen.getByRole('button', { name: '质疑' }))
    fireEvent.click(screen.getByRole('button', { name: '沉淀' }))

    expect(onExplain).toHaveBeenCalledTimes(1)
    expect(onCritique).toHaveBeenCalledTimes(1)
    expect(onMemoryCandidate).toHaveBeenCalledTimes(1)
  })

  it('disables fixed agent actions when no agent is available', () => {
    render(
      <SelectionToolbar
        x={120}
        y={80}
        onCopy={vi.fn()}
        onSearch={vi.fn()}
        onComment={vi.fn()}
        onExplain={vi.fn()}
        onCritique={vi.fn()}
        onMemoryCandidate={vi.fn()}
        agentActionsDisabled
      />,
    )

    expect(screen.getByRole('button', { name: '解释' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '质疑' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '沉淀' })).toBeDisabled()
  })
})
