import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { PaperSummary } from '@/types'
import { formatUpdatedAt } from '@/utils/paper'

interface PaperListItemProps {
  paper: PaperSummary
  recent?: boolean
}

export function PaperListItem({ paper, recent = false }: PaperListItemProps) {
  return (
    <Link
      to={`/reader/${encodeURIComponent(paper.id)}`}
      className="cark-card group flex min-w-0 w-full overflow-hidden rounded-[28px] px-5 py-5 transition duration-200 hover:border-[rgba(var(--accent-rgb),0.35)] hover:bg-[var(--surface-soft)]"
    >
      <div className="flex min-w-0 w-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {recent ? (
              <span className="cark-chip-accent rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]">
                最近阅读
              </span>
            ) : null}
          </div>
          <h3 className="cark-title max-w-full break-all font-serif text-xl">
            {paper.title}
          </h3>
          <p className="cark-muted text-sm">更新于 {formatUpdatedAt(paper.updatedAt)}</p>
        </div>

        <div className="cark-faint shrink-0 flex items-center gap-2 transition group-hover:text-[rgba(var(--accent-rgb),0.92)]">
          <span className="text-xs">阅读</span>
          <ArrowRight className="h-4 w-4" />
        </div>
      </div>

    </Link>
  )
}
