import type { PaperBlock, PaperView } from '@/types'

import { buildBlockSearchTerms, normalizeLocatorText } from '@/utils/blockLocator'

export interface SelectionToolbarState {
  view: PaperView
  blockId?: string | null
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop: number
  anchorHeight: number
  toolbarX: number
  toolbarY: number
}

export function readSelection(
  articleContainer: HTMLDivElement | null,
  articleShell: HTMLDivElement | null,
  activeView: PaperView,
  blocks: PaperBlock[],
): SelectionToolbarState | null {
  if (!articleContainer || !articleShell) {
    return null
  }

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  const commonNode = range.commonAncestorContainer
  if (!articleContainer.contains(commonNode.nodeType === Node.TEXT_NODE ? commonNode.parentNode : commonNode)) {
    return null
  }

  const quote = selection.toString().replace(/\s+/g, ' ').trim()
  if (!quote) {
    return null
  }

  const rangeRect = range.getBoundingClientRect()
  if (!rangeRect.width && !rangeRect.height) {
    return null
  }

  const shellRect = articleShell.getBoundingClientRect()
  const anchorElement = findSelectionAnchorElement(commonNode, articleContainer)
  const anchorSource = normalizeWhitespace(anchorElement?.innerText || anchorElement?.textContent || quote)
  const blockId = resolveSelectionBlockId(anchorElement, blocks)
  const normalizedQuote = normalizeWhitespace(quote)
  const quoteIndex = anchorSource.indexOf(normalizedQuote)
  const contextWindow = Math.min(Math.max(quote.length < 120 ? 36 : 52, 24), 52)
  return {
    view: activeView,
    blockId,
    quote: quote.slice(0, 600),
    contextBefore: quoteIndex >= 0 ? anchorSource.slice(Math.max(0, quoteIndex - contextWindow), quoteIndex) : null,
    contextAfter:
      quoteIndex >= 0
        ? anchorSource.slice(
            quoteIndex + normalizedQuote.length,
            quoteIndex + normalizedQuote.length + contextWindow,
          )
        : null,
    anchorTop: Math.max(rangeRect.top - shellRect.top, 0),
    anchorHeight: Math.max(rangeRect.height, 24),
    toolbarX: Math.max(220, Math.min(rangeRect.left + rangeRect.width / 2, window.innerWidth - 220)),
    toolbarY: Math.max(rangeRect.top - 12, 72),
  }
}

export function clearBrowserSelection() {
  window.getSelection()?.removeAllRanges()
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function findSelectionAnchorElement(node: Node, articleContainer: HTMLElement) {
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node
  while (current && current instanceof HTMLElement) {
    if (current.hasAttribute('data-locator-node')) {
      return current
    }
    current = current.parentElement
  }

  const fallback = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  return fallback instanceof HTMLElement && articleContainer.contains(fallback) ? fallback : null
}

function resolveSelectionBlockId(anchorElement: HTMLElement | null, blocks: PaperBlock[]) {
  const normalizedAnchor = normalizeLocatorText(anchorElement?.innerText || anchorElement?.textContent || '')
  if (!normalizedAnchor) {
    return null
  }

  let bestMatch: { blockId: string; score: number } | null = null
  for (const block of blocks) {
    const score = buildBlockSearchTerms(block)
      .map(normalizeLocatorText)
      .reduce((bestScore, term) => Math.max(bestScore, scoreBlockCandidate(normalizedAnchor, term)), 0)
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { blockId: block.id, score }
    }
  }

  return bestMatch && bestMatch.score > 0 ? bestMatch.blockId : null
}

function scoreBlockCandidate(anchorText: string, term: string) {
  if (!term) {
    return 0
  }
  if (anchorText === term) {
    return 1200 - term.length
  }
  if (anchorText.includes(term)) {
    return 900 - Math.max(0, anchorText.length - term.length)
  }
  if (term.includes(anchorText) && anchorText.length > 18) {
    return 700 - Math.max(0, term.length - anchorText.length)
  }
  return 0
}
