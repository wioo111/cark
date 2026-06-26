import type { ResearchMemoryItem } from '@/types'
import { buildLocatorSearchParams, buildPaperMemoryItemLocator } from '@/utils/stableLocator'

export function buildResearchMemoryHref(item: ResearchMemoryItem) {
  const locator = buildPaperMemoryItemLocator(item)
  const params = locator ? buildLocatorSearchParams(locator) : new URLSearchParams()
  if (!params.has('memory')) {
    params.set('memory', item.id)
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return `/reader/${encodeURIComponent(item.paperId)}${suffix}`
}
