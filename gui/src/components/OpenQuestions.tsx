import { Archive, Check, ExternalLink, HelpCircle, LoaderCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { patchPaperMemoryItem } from '@/api'
import type { ResearchMemoryItem } from '@/types'
import { buildResearchMemoryHref } from '@/utils/researchMemory'

interface OpenQuestionsProps {
  items: ResearchMemoryItem[]
  count: number
  loading: boolean
  error?: string | null
  onRefresh: () => void
  onChanged?: () => void
}

export function OpenQuestions({ items, count, loading, error, onRefresh, onChanged }: OpenQuestionsProps) {
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function markDone(item: ResearchMemoryItem) {
    setMutatingItemId(item.id)
    setActionError(null)
    try {
      await patchPaperMemoryItem(item.paperId, item.id, { status: 'done' })
      onChanged?.()
    } catch (markError) {
      setActionError(markError instanceof Error ? markError.message : '标记问题失败')
    } finally {
      setMutatingItemId(null)
    }
  }

  async function archiveItem(item: ResearchMemoryItem) {
    setMutatingItemId(item.id)
    setActionError(null)
    try {
      await patchPaperMemoryItem(item.paperId, item.id, { status: 'archived', activationStatus: 'archived' })
      onChanged?.()
    } catch (archiveError) {
      setActionError(archiveError instanceof Error ? archiveError.message : '归档问题失败')
    } finally {
      setMutatingItemId(null)
    }
  }

  return (
    <section className="cark-panel rounded-[30px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="cark-faint inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
            <HelpCircle className="h-3.5 w-3.5" />
            未解问题
          </p>
          <h2 className="cark-title mt-1 font-serif text-2xl">{count}</h2>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="cark-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="刷新未解问题"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error || actionError ? (
        <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error || actionError}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {items.slice(0, 5).map((item) => (
          <article key={item.id} className="rounded-[20px] border [border-color:var(--border-soft)] bg-[var(--surface-soft)] px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="cark-text line-clamp-3 text-sm leading-6">{item.text}</p>
                <p className="cark-faint mt-2 line-clamp-1 text-xs">{item.paperTitle}</p>
              </div>
              <Link
                to={buildResearchMemoryHref(item)}
                className="cark-button-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                aria-label="打开问题来源"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
            {item.evidence?.[0]?.quote ? (
              <p className="cark-faint mt-3 line-clamp-2 border-l-2 border-[rgba(var(--accent-rgb),0.35)] pl-3 text-xs leading-5">
                {item.evidence[0].quote}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={mutatingItemId === item.id}
                onClick={() => void markDone(item)}
                className="cark-button-accent inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mutatingItemId === item.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                已解决
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

        {!loading && items.length === 0 ? (
          <div className="cark-faint rounded-[20px] border border-dashed [border-color:var(--border-strong)] px-4 py-5 text-sm">
            暂时没有未解问题。
          </div>
        ) : null}
      </div>
    </section>
  )
}
