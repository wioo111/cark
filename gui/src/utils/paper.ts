import type { OutlineItem, PaperSummary, PaperView } from '@/types'

const outlinePattern = /^(#{1,6})\s+(.+)$/gm

export function extractOutline(markdown: string): OutlineItem[] {
  const matches = markdown.matchAll(outlinePattern)

  return Array.from(matches).map((match, index) => ({
    id: `section-${index + 1}`,
    level: match[1].length,
    text: match[2].trim(),
  }))
}

export function getPreferredView(views: PaperView[]): PaperView {
  if (views.includes('bilingual')) {
    return 'bilingual'
  }
  return 'linearized'
}

export function resolvePaperView(
  views: PaperView[],
  requestedView: PaperView | null,
  restoredView: PaperView | null,
): PaperView {
  if (requestedView && views.includes(requestedView)) {
    return requestedView
  }
  if (restoredView && views.includes(restoredView)) {
    return restoredView
  }
  return getPreferredView(views)
}

export function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function matchesQuery(paper: PaperSummary, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return true
  }

  const haystack = [paper.title, paper.taskId ?? '', paper.sourcePdf ?? '']
    .join(' ')
    .toLowerCase()

  return haystack.includes(keyword)
}
