import type { PaperAnnotation } from '@/types'

export interface ResolvedAnnotationAnchor {
  top: number
  height: number
}

export interface AnnotationHighlightRect {
  top: number
  left: number
  width: number
  height: number
}

export interface ResolvedAnnotationHighlight extends ResolvedAnnotationAnchor {
  element: HTMLElement
  rects: AnnotationHighlightRect[]
}

export function resolveAnnotationAnchor(
  articleContainer: HTMLElement,
  articleShell: HTMLElement,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
): ResolvedAnnotationAnchor | null {
  const resolved = resolveAnnotationHighlight(articleContainer, articleShell, annotation)
  return resolved ? { top: resolved.top, height: resolved.height } : null
}

export function resolveAnnotationHighlight(
  articleContainer: HTMLElement,
  articleShell: HTMLElement,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
): ResolvedAnnotationHighlight | null {
  const bestMatch = findBestAnnotationMatch(articleContainer, annotation)
  if (!bestMatch) {
    return null
  }

  const shellRect = articleShell.getBoundingClientRect()
  const exactRange = resolveExactAnnotationRange(bestMatch.element, annotation)
  const exactRects = exactRange
    ? Array.from(exactRange.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          top: Math.max(rect.top - shellRect.top, 0),
          left: Math.max(rect.left - shellRect.left, 0),
          width: rect.width,
          height: rect.height,
        }))
    : []

  if (exactRects.length > 0) {
    const top = Math.min(...exactRects.map((rect) => rect.top))
    const bottom = Math.max(...exactRects.map((rect) => rect.top + rect.height))
    return {
      element: bestMatch.element,
      rects: exactRects,
      top,
      height: Math.max(bottom - top, 24),
    }
  }

  const elementRect = bestMatch.element.getBoundingClientRect()
  return {
    element: bestMatch.element,
    rects: [],
    top: Math.max(elementRect.top - shellRect.top, 0),
    height: Math.max(elementRect.height, 24),
  }
}

export function findBestAnnotationMatch(
  articleContainer: HTMLElement,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
) {
  const candidates = Array.from(articleContainer.querySelectorAll<HTMLElement>('[data-locator-node="true"]'))
  if (candidates.length === 0) {
    return null
  }

  const normalizedQuote = normalizeAnnotationText(annotation.quote)
  const normalizedBefore = normalizeAnnotationText(annotation.contextBefore ?? '')
  const normalizedAfter = normalizeAnnotationText(annotation.contextAfter ?? '')
  let bestMatch: { element: HTMLElement; score: number } | null = null

  for (const element of candidates) {
    const normalizedText = normalizeAnnotationText(element.innerText || element.textContent || '')
    if (!normalizedText) {
      continue
    }

    let score = 0
    if (normalizedQuote && normalizedText.includes(normalizedQuote)) {
      score += 6
    } else if (normalizedQuote && hasQuoteFragment(normalizedText, normalizedQuote)) {
      score += 3
    }

    if (normalizedBefore && normalizedText.includes(normalizedBefore)) {
      score += 2
    }

    if (normalizedAfter && normalizedText.includes(normalizedAfter)) {
      score += 2
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { element, score }
    }
  }

  return bestMatch && bestMatch.score > 0 ? bestMatch : null
}

export function normalizeAnnotationText(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toLowerCase()
}

function hasQuoteFragment(text: string, quote: string) {
  if (quote.length < 16) {
    return false
  }

  const head = quote.slice(0, Math.min(quote.length, 24))
  const tail = quote.slice(Math.max(quote.length - 24, 0))
  return text.includes(head) || text.includes(tail)
}

function resolveExactAnnotationRange(
  element: HTMLElement,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
) {
  const textNodes = collectTextNodes(element)
  if (textNodes.length === 0) {
    return null
  }

  const rawText = textNodes.map((item) => item.node.nodeValue ?? '').join('')
  const location = locateQuoteInRawText(rawText, annotation)
  if (!location) {
    return null
  }

  const startPosition = resolveTextPosition(textNodes, location.start)
  const endPosition = resolveTextPosition(textNodes, location.end)
  if (!startPosition || !endPosition) {
    return null
  }

  const range = document.createRange()
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset)
  return range
}

function collectTextNodes(element: HTMLElement) {
  const textNodes: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0
  let current = walker.nextNode()
  while (current) {
    if (current instanceof Text) {
      const value = current.nodeValue ?? ''
      const length = value.length
      if (length > 0) {
        textNodes.push({ node: current, start: offset, end: offset + length })
        offset += length
      }
    }
    current = walker.nextNode()
  }
  return textNodes
}

function resolveTextPosition(
  textNodes: Array<{ node: Text; start: number; end: number }>,
  index: number,
) {
  for (const item of textNodes) {
    if (index <= item.end) {
      return {
        node: item.node,
        offset: Math.max(0, Math.min(index - item.start, item.node.nodeValue?.length ?? 0)),
      }
    }
  }

  const tail = textNodes[textNodes.length - 1]
  if (!tail) {
    return null
  }
  return {
    node: tail.node,
    offset: tail.node.nodeValue?.length ?? 0,
  }
}

function locateQuoteInRawText(
  rawText: string,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
) {
  const quote = annotation.quote.trim()
  if (!quote) {
    return null
  }

  const exactMatches = findAllOccurrences(rawText, quote)
  if (exactMatches.length > 0) {
    return chooseBestMatch(rawText, exactMatches, annotation)
  }

  return locateNormalizedQuote(rawText, annotation)
}

function findAllOccurrences(text: string, needle: string) {
  const matches: Array<{ start: number; end: number }> = []
  let cursor = 0
  while (cursor <= text.length) {
    const found = text.indexOf(needle, cursor)
    if (found < 0) {
      break
    }
    matches.push({ start: found, end: found + needle.length })
    cursor = found + Math.max(needle.length, 1)
  }
  return matches
}

function chooseBestMatch(
  rawText: string,
  matches: Array<{ start: number; end: number }>,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
) {
  const normalizedBefore = normalizeAnnotationText(annotation.contextBefore ?? '')
  const normalizedAfter = normalizeAnnotationText(annotation.contextAfter ?? '')
  let bestMatch: { start: number; end: number; score: number } | null = null

  for (const match of matches) {
    let score = 1
    const beforeText = normalizeAnnotationText(rawText.slice(Math.max(0, match.start - 120), match.start))
    const afterText = normalizeAnnotationText(rawText.slice(match.end, match.end + 120))
    if (normalizedBefore && beforeText.includes(normalizedBefore)) {
      score += 3
    }
    if (normalizedAfter && afterText.includes(normalizedAfter)) {
      score += 3
    }
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { ...match, score }
    }
  }

  return bestMatch ? { start: bestMatch.start, end: bestMatch.end } : null
}

function locateNormalizedQuote(
  rawText: string,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
) {
  const rawMap = buildNormalizedIndexMap(rawText)
  const normalizedQuote = normalizeAnnotationText(annotation.quote)
  if (!normalizedQuote) {
    return null
  }

  const matches = findAllOccurrences(rawMap.normalized, normalizedQuote)
  if (matches.length === 0) {
    return null
  }

  const normalizedBefore = normalizeAnnotationText(annotation.contextBefore ?? '')
  const normalizedAfter = normalizeAnnotationText(annotation.contextAfter ?? '')
  let bestMatch: { start: number; end: number; score: number } | null = null
  for (const match of matches) {
    let score = 1
    const beforeText = rawMap.normalized.slice(Math.max(0, match.start - 120), match.start)
    const afterText = rawMap.normalized.slice(match.end, match.end + 120)
    if (normalizedBefore && beforeText.includes(normalizedBefore)) {
      score += 3
    }
    if (normalizedAfter && afterText.includes(normalizedAfter)) {
      score += 3
    }
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { ...match, score }
    }
  }

  if (!bestMatch) {
    return null
  }

  const rawStart = rawMap.indices[bestMatch.start]
  const rawEndIndex = rawMap.indices[bestMatch.end - 1]
  if (rawStart === undefined || rawEndIndex === undefined) {
    return null
  }
  return {
    start: rawStart,
    end: rawEndIndex + 1,
  }
}

function buildNormalizedIndexMap(rawText: string) {
  let normalized = ''
  const indices: number[] = []
  let pendingSpace = false

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index]
    if (/\s/u.test(char)) {
      pendingSpace = normalized.length > 0
      continue
    }
    if (/[^\p{L}\p{N}]/u.test(char)) {
      continue
    }
    if (pendingSpace && normalized.length > 0) {
      normalized += ' '
      indices.push(index)
      pendingSpace = false
    }
    normalized += char.toLowerCase()
    indices.push(index)
  }

  return { normalized, indices }
}
