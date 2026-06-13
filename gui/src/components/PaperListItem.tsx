import { ArrowRight, Image as ImageIcon, Languages } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { PaperSummary } from '@/types'
import { formatUpdatedAt } from '@/utils/paper'

interface PaperListItemProps {
  paper: PaperSummary
  recent?: boolean
}

const viewLabelMap = {
  linearized: '结构化原文',
  bilingual: '中英双语',
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

      <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
        {paper.availableViews.map((view) => (
          <span key={view} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
            {viewLabelMap[view]}
          </span>
        ))}
        {paper.hasImages ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-teal-400/20 bg-teal-400/10 px-3 py-1.5 text-teal-100">
            <ImageIcon className="h-3.5 w-3.5" />
            图片
          </span>
        ) : null}
        {paper.availableViews.includes('bilingual') ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-sky-100">
            <Languages className="h-3.5 w-3.5" />
            可验双语
          </span>
        ) : null}
      </div>
    </Link>
  )
}
