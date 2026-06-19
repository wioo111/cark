import type { PaperMemoryItem, PaperView, SearchResult, StableLocator } from '@/types'

const LOCATOR_KEYS = [
  'view',
  'annotation',
  'comment',
  'memory',
  'block',
  'quote',
  'before',
  'after',
] as const

function optionalString(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function normalizeStableLocator(locator?: StableLocator | null) {
  if (!locator) {
    return null
  }

  const normalized: StableLocator = {}
  const view = optionalString(locator.view ?? undefined)
  if (view) {
    normalized.view = view as PaperView
  }
  const annotationId = optionalString(locator.annotationId ?? undefined)
  if (annotationId) {
    normalized.annotationId = annotationId
  }
  const commentId = optionalString(locator.commentId ?? undefined)
  if (commentId) {
    normalized.commentId = commentId
  }
  const memoryItemId = optionalString(locator.memoryItemId ?? undefined)
  if (memoryItemId) {
    normalized.memoryItemId = memoryItemId
  }
  const blockId = optionalString(locator.blockId ?? undefined)
  if (blockId) {
    normalized.blockId = blockId
  }
  const quote = optionalString(locator.quote ?? undefined)
  if (quote) {
    normalized.quote = quote
  }
  const contextBefore = optionalString(locator.contextBefore ?? undefined)
  if (contextBefore) {
    normalized.contextBefore = contextBefore
  }
  const contextAfter = optionalString(locator.contextAfter ?? undefined)
  if (contextAfter) {
    normalized.contextAfter = contextAfter
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

export function buildSearchResultLocator(result: SearchResult) {
  if (result.locator) {
    return normalizeStableLocator(result.locator)
  }

  return normalizeStableLocator({
    view: result.view ?? null,
    annotationId: result.annotationId ?? null,
    memoryItemId: result.memoryItemId ?? null,
    quote: result.source === 'body' ? (result.matchQuote ?? null) : null,
    contextBefore: result.source === 'body' ? (result.matchContextBefore ?? null) : null,
    contextAfter: result.source === 'body' ? (result.matchContextAfter ?? null) : null,
  })
}

export function buildPaperMemoryItemLocator(item: PaperMemoryItem) {
  if (item.locator) {
    return normalizeStableLocator(item.locator)
  }

  return normalizeStableLocator({
    view: item.anchor?.view ?? null,
    annotationId: item.sourceAnnotationId ?? null,
    memoryItemId: item.id,
    blockId: item.blockId ?? null,
    quote: item.quote ?? item.anchor?.quote ?? null,
    contextBefore: item.anchor?.contextBefore ?? null,
    contextAfter: item.anchor?.contextAfter ?? null,
  })
}

export function applyLocatorToSearchParams(
  params: URLSearchParams,
  locator?: StableLocator | null,
) {
  LOCATOR_KEYS.forEach((key) => params.delete(key))

  const normalized = normalizeStableLocator(locator)
  if (!normalized) {
    return params
  }

  if (normalized.view) {
    params.set('view', normalized.view)
  }
  if (normalized.annotationId) {
    params.set('annotation', normalized.annotationId)
  }
  if (normalized.commentId) {
    params.set('comment', normalized.commentId)
  }
  if (normalized.memoryItemId) {
    params.set('memory', normalized.memoryItemId)
  }
  if (normalized.blockId) {
    params.set('block', normalized.blockId)
  }
  if (normalized.quote) {
    params.set('quote', normalized.quote)
  }
  if (normalized.contextBefore) {
    params.set('before', normalized.contextBefore)
  }
  if (normalized.contextAfter) {
    params.set('after', normalized.contextAfter)
  }
  return params
}

export function buildLocatorSearchParams(locator?: StableLocator | null) {
  return applyLocatorToSearchParams(new URLSearchParams(), locator)
}

export function parseLocatorFromSearchParams(searchParams: URLSearchParams) {
  return normalizeStableLocator({
    view: searchParams.get('view') as PaperView | null,
    annotationId: searchParams.get('annotation'),
    commentId: searchParams.get('comment'),
    memoryItemId: searchParams.get('memory'),
    blockId: searchParams.get('block'),
    quote: searchParams.get('quote'),
    contextBefore: searchParams.get('before'),
    contextAfter: searchParams.get('after'),
  })
}
