import type { PaperBlock } from '@/types'

const LOCATOR_SELECTOR = '[data-locator-node="true"]'

export function normalizeLocatorText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shorten(text: string, max = 120) {
  return text.length <= max ? text : text.slice(0, max)
}

function buildSearchTerms(block: PaperBlock) {
  if (block.type === 'image') {
    const imageName = block.imagePath?.split('/').pop()
    return [imageName ?? '', ...(block.imageCaption ?? []), ...(block.imageFootnote ?? [])]
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const raw = block.matchText || block.preview
  if (!raw) {
    return []
  }

  const compact = raw.replace(/\s+/g, ' ').trim()
  return [
    shorten(compact, 200),
    shorten(compact, 120),
    shorten(compact, 64),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
}

export function clearLocatorHighlights(container: HTMLElement) {
  container.querySelectorAll('[data-block-active="true"]').forEach((node) => {
    if (node instanceof HTMLElement) {
      node.removeAttribute('data-block-active')
      node.classList.remove('block-locator-active')
    }
  })
}

export function locateBlockNode(container: HTMLElement, block: PaperBlock) {
  if (block.type === 'image') {
    const filename = block.imagePath?.split('/').pop()
    if (!filename) {
      return null
    }

    const images = Array.from(container.querySelectorAll('img[data-locator-node="true"]'))
    return images.find((node) => node.getAttribute('src')?.includes(filename)) ?? null
  }

  const terms = buildSearchTerms(block).map(normalizeLocatorText).filter(Boolean)
  if (terms.length === 0) {
    return null
  }

  const candidates = Array.from(container.querySelectorAll(LOCATOR_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.tagName !== 'IMG',
  )

  const scored = candidates
    .map((node) => {
      const normalized = normalizeLocatorText(node.textContent || '')
      let score = 0

      for (const term of terms) {
        if (!term) {
          continue
        }
        if (normalized === term) {
          score = Math.max(score, 1000 - normalized.length)
        } else if (normalized.includes(term)) {
          score = Math.max(score, 800 - Math.max(0, normalized.length - term.length))
        } else if (term.includes(normalized) && normalized.length > 18) {
          score = Math.max(score, 500 - Math.max(0, term.length - normalized.length))
        }
      }

      return { node, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return scored[0]?.node ?? null
}

export function activateLocatedNode(target: Element | null) {
  if (!(target instanceof HTMLElement)) {
    return
  }

  target.setAttribute('data-block-active', 'true')
  target.classList.add('block-locator-active')
  target.scrollIntoView({ behavior: 'auto', block: 'center' })
}
