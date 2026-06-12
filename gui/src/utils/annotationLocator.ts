import type { PaperAnnotation } from '@/types'

export interface ResolvedAnnotationAnchor {
  top: number
  height: number
}

export function resolveAnnotationAnchor(
  articleContainer: HTMLElement,
  articleShell: HTMLElement,
  annotation: Pick<PaperAnnotation, 'quote' | 'contextBefore' | 'contextAfter'>,
): ResolvedAnnotationAnchor | null {
  const bestMatch = findBestAnnotationMatch(articleContainer, annotation)
  if (!bestMatch) {
    return null
  }

  const shellRect = articleShell.getBoundingClientRect()
  const elementRect = bestMatch.element.getBoundingClientRect()
  return {
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
