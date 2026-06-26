import { ExternalLink, Lightbulb, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { ResearchMemoryItem } from '@/types'
import { buildResearchMemoryHref } from '@/utils/researchMemory'

interface RecentInsightsProps {
  items: ResearchMemoryItem[]
  count: number
  loading: boolean
  error?: string | null
  onRefresh: () => void
}

export function RecentInsights({ items, count, loading, error, onRefresh }: RecentInsightsProps) {
  return (
    <section className="cark-panel rounded-[30px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="cark-faint inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
            <Lightbulb className="h-3.5 w-3.5" />
            最近判断
          </p>
          <h2 className="cark-title mt-1 font-serif text-2xl">{count}</h2>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="cark-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="刷新最近判断"
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
                aria-label="打开判断来源"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
            {item.evidence?.[0]?.quote ? (
              <p className="cark-faint mt-3 line-clamp-2 border-l-2 border-[rgba(var(--accent-rgb),0.35)] pl-3 text-xs leading-5">
                {item.evidence[0].quote}
              </p>
            ) : null}
          </article>
        ))}

        {!loading && items.length === 0 ? (
          <div className="cark-faint rounded-[20px] border border-dashed [border-color:var(--border-strong)] px-4 py-5 text-sm">
            还没有已确认判断。
          </div>
        ) : null}
      </div>
    </section>
  )
}
