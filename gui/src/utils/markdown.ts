interface MarkdownTreeNode {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: MarkdownTreeNode[]
}

export function resolveMediaUrl(paperId: string, source: string) {
  if (
    !source
    || /^(https?:|data:)/i.test(source)
    || source.startsWith('#')
  ) {
    return source
  }

  let decodedSource = source
  try {
    decodedSource = decodeURIComponent(source)
  } catch {
    decodedSource = source
  }

  const cleaned = decodedSource
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^file:\/+/i, '')
    .replace(/^\.?\//, '')
  const imagesIndex = cleaned.toLowerCase().lastIndexOf('/images/')
  const normalized = imagesIndex >= 0
    ? cleaned.slice(imagesIndex + 1)
    : cleaned.replace(/^auto\//i, '')
  const relativePath = normalized.startsWith('images/')
    ? `auto/${normalized}`
    : normalized

  return `/api/media/${encodeURIComponent(paperId)}?path=${encodeURIComponent(relativePath)}`
}

export function rehypeSectionIds() {
  return (tree: MarkdownTreeNode) => {
    let sectionIndex = 0

    function visit(node: MarkdownTreeNode) {
      if (
        node.type === 'element'
        && typeof node.tagName === 'string'
        && /^h[1-6]$/.test(node.tagName)
      ) {
        sectionIndex += 1
        node.properties = {
          ...node.properties,
          id: `section-${sectionIndex}`,
        }
      }
      node.children?.forEach(visit)
    }

    visit(tree)
  }
}

export function scrollToArticleSection(container: ParentNode, id: string) {
  const target = container.querySelector<HTMLElement>(`#${id}`)
  if (!target) {
    return false
  }

  const targetTop = Math.max(window.scrollY + target.getBoundingClientRect().top - 24, 0)
  window.scrollTo({ top: targetTop, behavior: 'auto' })
  return true
}
