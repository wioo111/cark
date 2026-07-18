// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeSwitch } from '@/components/ThemeSwitch'

describe('ThemeSwitch', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme-mode')
    document.documentElement.removeAttribute('data-theme-background')
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false }),
    )
  })

  it('changes reading mode and background without leaving the reader', async () => {
    render(<ThemeSwitch />)

    fireEvent.click(screen.getByRole('button', { name: '切到夜间' }))
    fireEvent.click(screen.getByRole('button', { name: '切换到森林背景' }))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme-mode', 'dark')
      expect(document.documentElement).toHaveAttribute('data-theme-background', 'forest')
    })
    expect(screen.getByRole('button', { name: '切换到森林背景' })).toHaveAttribute('aria-pressed', 'true')
  })
})
