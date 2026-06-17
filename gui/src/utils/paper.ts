import type { OutlineItem, PaperSummary, PaperView } from '@/types'

const outlinePattern = /^(#{1,6})\s+(.+)$/gm

export function extractOutline(markdown: string): OutlineItem[] {
  const matches = markdown.matchAll(outlinePattern)

  return dedupeOutline(
    Array.from(matches).map((match, index) => ({
      id: `section-${index + 1}`,
      level: match[1].length,
      text: match[2].trim(),
    })),
  )
}

export function cleanBilingualMarkdown(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+(?:Original Heading|Translated Heading)\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
}

export function extractBilingualOutline(
  originalMarkdown: string,
  bilingualMarkdown: string,
): OutlineItem[] {
  const originalHeadings = Array.from(originalMarkdown.matchAll(outlinePattern)).map((match) => ({
    level: match[1].length,
    text: match[2].trim(),
  }))
  const bilingualHeadings = Array.from(bilingualMarkdown.matchAll(outlinePattern)).map((match, index) => ({
    id: `section-${index + 1}`,
    level: match[1].length,
    text: match[2].trim(),
  }))
  let cursor = 0
  const outline: OutlineItem[] = []

  for (const original of originalHeadings) {
    const normalized = normalizeHeading(original.text)
    const matchIndex = bilingualHeadings.findIndex(
      (candidate, index) => index >= cursor && normalizeHeading(candidate.text) === normalized,
    )
    if (matchIndex < 0) {
      continue
    }
    const translatedText = findTranslatedHeading(bilingualHeadings, matchIndex)
    outline.push({
      id: bilingualHeadings[matchIndex].id,
      level: original.level,
      text: original.text,
      translatedText,
    })
    cursor = matchIndex + 1
  }

  return dedupeOutline(outline)
}

function normalizeHeading(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[.:：。]\s*$/g, '')
    .replace(/\s+/g, ' ')
}

function findTranslatedHeading(
  headings: Array<{ id: string; level: number; text: string }>,
  originalIndex: number,
) {
  const original = headings[originalIndex]
  const candidate = headings[originalIndex + 1]
  if (!original || !candidate) {
    return undefined
  }
  if (candidate.level !== original.level) {
    return undefined
  }
  if (normalizeHeading(candidate.text) === normalizeHeading(original.text)) {
    return undefined
  }
  return candidate.text
}

function dedupeOutline(outline: OutlineItem[]) {
  return outline.filter((item, index) => {
    if (index === 0) {
      return true
    }
    return normalizeHeading(item.text) !== normalizeHeading(outline[index - 1].text)
  })
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
