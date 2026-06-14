// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownArticle } from '@/components/MarkdownArticle'
import { resolveMediaUrl, scrollToArticleSection } from '@/utils/markdown'

describe('MarkdownArticle', () => {
  it('renders stable section ids for outline navigation', () => {
    render(
      <MarkdownArticle
        paperId="paper-1"
        markdown={'# Introduction\n\nBody\n\n## Results'}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Introduction' })).toHaveAttribute('id', 'section-1')
    expect(screen.getByRole('heading', { name: 'Results' })).toHaveAttribute('id', 'section-2')
  })

  it('renders and rewrites images embedded in raw HTML tables', () => {
    render(
      <MarkdownArticle
        paperId="paper/1"
        markdown={'<table><tbody><tr><td><img src="images/figure.jpg" alt="Figure"></td></tr></tbody></table>'}
      />,
    )

    expect(screen.getByRole('img', { name: 'Figure' })).toHaveAttribute(
      'src',
      '/api/media/paper%2F1?path=auto%2Fimages%2Ffigure.jpg',
    )
  })

  it('sanitizes unsafe raw HTML while preserving math rendering', () => {
    const { container } = render(
      <MarkdownArticle
        paperId="paper-1"
        markdown={'<script>alert(1)</script><iframe src="https://example.test"></iframe>\n\n$x^2$'}
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('normalizes historical absolute and encoded image paths', () => {
    expect(
      resolveMediaUrl(
        'paper-1',
        'D:\\archive\\paper\\auto\\images\\figure%201.jpg?cache=old',
      ),
    ).toBe('/api/media/paper-1?path=auto%2Fimages%2Ffigure%201.jpg')
  })

  it('jumps to a section immediately with the reader offset', () => {
    const container = document.createElement('article')
    const heading = document.createElement('h2')
    heading.id = 'section-61'
    heading.getBoundingClientRect = () => ({ top: 300 }) as DOMRect
    container.appendChild(heading)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    expect(scrollToArticleSection(container, 'section-61')).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 376, behavior: 'auto' })
    expect(scrollToArticleSection(container, 'section-missing')).toBe(false)
  })
})
