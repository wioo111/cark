import { Archive, Check, ExternalLink, Inbox, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  fetchMemoryCandidates,
  postActivateMemoryCandidate,
  postArchiveMemoryCandidate,
} from '@/api'
import type { MemoryCandidateItem, PaperMemoryItem, StableLocator } from '@/types'
import { buildLocatorSearchParams, buildPaperMemoryItemLocator } from '@/utils/stableLocator'

interface MemoryInboxProps {
  onChanged?: () => void
}

export function MemoryInbox({ onChanged }: MemoryInboxProps) {
  const [items, setItems] = useState<MemoryCandidateItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null)

  useEffect(() => {
    void loadCandidates()
  }, [])

  const visibleItems = useMemo(() => items.slice(0, 5), [items])

  async function loadCandidates() {
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchMemoryCandidates()
      setItems(payload.items)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '待确认记忆加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function activateItem(item: MemoryCandidateItem) {
    setMutatingItemId(item.id)
    setError(null)
    try {
      await postActivateMemoryCandidate(item.id)
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      onChanged?.()
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : '确认记忆失败')
    } finally {
      setMutatingItemId(null)
    }
  }

  async function archiveItem(item: MemoryCandidateItem) {
    setMutatingItemId(item.id)
    setError(null)
    try {
      await postArchiveMemoryCandidate(item.id)
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      onChanged?.()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : '归档记忆失败')
    } finally {
      setMutatingItemId(null)
    }
  }

  return (
    <section className="cark-panel rounded-[30px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="cark-faint inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
            <Inbox className="h-3.5 w-3.5" />
            待确认记忆
          </p>
          <h2 className="cark-title mt-1 font-serif text-2xl">{items.length}</h2>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadCandidates()}
          className="cark-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="刷新待确认记忆"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded-[20px] border [border-color:var(--border-soft)] bg-[var(--surface-soft)] px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cark-chip-accent rounded-full px-2.5 py-1 text-[11px] uppercase">{item.type}</span>
                  <span className="cark-faint rounded-full border [border-color:var(--border-soft)] px-2.5 py-1 text-[11px] uppercase">
                    {item.layer === 'paper' ? 'paper' : 'global'}
                  </span>
                </div>
                {item.paperTitle ? <p className="cark-faint mt-2 line-clamp-1 text-xs">{item.paperTitle}</p> : null}
              </div>
              {item.paperId ? (
                <Link
                  to={buildMemoryCandidateHref(item)}
                  className="cark-button-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  aria-label="打开记忆来源"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
            <p className="cark-text mt-3 line-clamp-3 text-sm leading-6">{item.text}</p>
            {item.evidence?.[0]?.quote ? (
              <p className="cark-faint mt-3 line-clamp-2 border-l-2 border-[rgba(var(--accent-rgb),0.35)] pl-3 text-xs leading-5">
                {item.evidence[0].quote}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={mutatingItemId === item.id}
                onClick={() => void activateItem(item)}
                className="cark-button-accent inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mutatingItemId === item.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                确认
              </button>
              <button
                type="button"
                disabled={mutatingItemId === item.id}
                onClick={() => void archiveItem(item)}
                className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Archive className="h-3.5 w-3.5" />
                归档
              </button>
            </div>
          </article>
        ))}

        {!loading && visibleItems.length === 0 ? (
          <div className="cark-faint rounded-[20px] border border-dashed [border-color:var(--border-strong)] px-4 py-5 text-sm">
            当前没有待确认记忆。
          </div>
        ) : null}
      </div>
    </section>
  )
}

function buildMemoryCandidateHref(item: MemoryCandidateItem) {
  const paperId = item.paperId ?? ''
  const locator = item.layer === 'paper'
    ? buildPaperMemoryItemLocator(item as PaperMemoryItem)
    : normalizeCandidateLocator(item.locator)
  const params = locator ? buildLocatorSearchParams(locator) : new URLSearchParams()
  if (item.layer === 'paper' && !params.has('memory')) {
    params.set('memory', item.id)
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return `/reader/${encodeURIComponent(paperId)}${suffix}`
}

function normalizeCandidateLocator(locator: unknown): StableLocator | null {
  return locator && typeof locator === 'object' ? locator as StableLocator : null
}
