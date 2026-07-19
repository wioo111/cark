import type { PaperDetail } from '@/types'
import { resolveMediaUrl } from '@/utils/markdown'
import { withApiBaseUrl } from '@/utils/apiBase'

export const PAPER_CACHE_NAME = 'cark-paper-v1'
const OFFLINE_LIBRARY_KEY = 'cark-offline-library-v1'

export interface OfflinePaperEntry {
  id: string
  title: string
  downloadedAt: string
}

function readLibrary(): OfflinePaperEntry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(OFFLINE_LIBRARY_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeLibrary(entries: OfflinePaperEntry[]) {
  window.localStorage.setItem(OFFLINE_LIBRARY_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent('cark-offline-library-change'))
}

export function registerOfflinePaper(entry: OfflinePaperEntry) {
  writeLibrary([entry, ...readLibrary().filter((item) => item.id !== entry.id)])
}

export function listOfflinePapers() {
  return readLibrary()
}

export function isPaperOffline(paperId: string) {
  return readLibrary().some((entry) => entry.id === paperId)
}

function markdownImageSources(markdown: string) {
  const sources = new Set<string>()
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)) {
    const source = match[1] || match[2]
    if (source) sources.add(source)
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) sources.add(match[1])
  }
  return [...sources]
}

async function cacheUrl(cache: Cache, url: string) {
  const resolvedUrl = withApiBaseUrl(url) as string
  const response = await fetch(resolvedUrl, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`下载失败 (${response.status})`)
  await cache.put(resolvedUrl, response.clone())
}

export async function downloadPaperForOffline(detail: PaperDetail) {
  if (!('caches' in window)) throw new Error('当前浏览器不支持离线存储')

  const cache = await window.caches.open(PAPER_CACHE_NAME)
  const paperId = encodeURIComponent(detail.id)
  const urls = new Set<string>([
    '/api/papers',
    `/api/papers/${paperId}`,
    `/api/papers/${paperId}/annotations`,
    `/api/papers/${paperId}/reading-state`,
  ])

  for (const image of detail.images) {
    if (image.url) urls.add(image.url)
  }
  for (const markdown of Object.values(detail.markdown)) {
    for (const source of markdownImageSources(markdown ?? '')) {
      const url = resolveMediaUrl(detail.id, source)
      if (url && !url.startsWith('data:')) urls.add(url)
    }
  }

  const results = await Promise.allSettled([...urls].map((url) => cacheUrl(cache, url)))
  if (results[0]?.status === 'rejected') throw results[0].reason

  const nextEntry: OfflinePaperEntry = {
    id: detail.id,
    title: detail.title,
    downloadedAt: new Date().toISOString(),
  }
  registerOfflinePaper(nextEntry)
  return { downloaded: results.filter((result) => result.status === 'fulfilled').length, total: results.length }
}

export async function removeOfflinePaper(paperId: string) {
  if ('caches' in window) {
    const cache = await window.caches.open(PAPER_CACHE_NAME)
    const keys = await cache.keys()
    const encodedId = encodeURIComponent(paperId)
    await Promise.all(
      keys
        .filter((request) => {
          const url = new URL(request.url)
          return url.pathname.includes(`/api/papers/${encodedId}`)
            || url.pathname.includes(`/api/media/${encodedId}`)
        })
        .map((request) => cache.delete(request)),
    )
  }
  writeLibrary(readLibrary().filter((entry) => entry.id !== paperId))
}
