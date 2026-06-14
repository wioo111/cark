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
      className="group flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.03] px-5 py-5 transition duration-200 hover:border-amber-300/40 hover:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {recent ? (
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-amber-200">
                最近阅读
              </span>
            ) : null}
          </div>
          <h3 className="max-w-3xl text-balance font-serif text-xl text-zinc-100">{paper.title}</h3>
          <p className="text-sm text-zinc-400">更新于 {formatUpdatedAt(paper.updatedAt)}</p>
        </div>

        <div className="flex items-center gap-2 text-zinc-500 transition group-hover:text-amber-200">
          <span className="text-xs">阅读</span>
          <ArrowRight className="h-4 w-4" />
        </div>
      </div>

    </Link>
  )
}
