import { Focus, Image as ImageIcon, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { PaperBlock } from '@/types'

interface BlockLocatorPanelProps {
  blocks: PaperBlock[]
  selectedBlockId: string | null
  locatorStatus: 'idle' | 'matched' | 'failed'
  onSelectBlock: (blockId: string) => void
}

function matchesBlock(block: PaperBlock, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return true
  }
  return `${block.preview} ${block.type} ${block.pageIdx ?? ''}`.toLowerCase().includes(keyword)
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    table: '表格',
    equation: '公式',
    formula: '公式',
    title: '标题',
  }
  return labels[type] ?? type
}

export function BlockLocatorPanel({ blocks, selectedBlockId, locatorStatus, onSelectBlock }: BlockLocatorPanelProps) {
  const [query, setQuery] = useState('')

  const filteredBlocks = useMemo(
    () => blocks.filter((block) => matchesBlock(block, query)),
    [blocks, query],
  )

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-2 text-emerald-200">
          <Focus className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">底层结构映射</p>
          <h2 className="mt-1 font-serif text-xl text-zinc-100">解析块定位器</h2>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
        <span>{filteredBlocks.length} / {blocks.length} 个结构块</span>
        <span>
          {locatorStatus === 'matched' ? '已定位' : locatorStatus === 'failed' ? '未命中正文' : '待选择'}
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="检索解析块内容、页码或类型"
          className="w-full rounded-[18px] border border-white/10 bg-black/20 py-3 pl-11 pr-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/40"
        />
      </div>

      <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {filteredBlocks.map((block) => (
          <button
            key={block.id}
            type="button"
            onClick={() => onSelectBlock(block.id)}
            className={[
              'w-full rounded-[22px] border px-4 py-4 text-left transition',
              selectedBlockId === block.id
                ? 'border-emerald-300/40 bg-emerald-300/10'
                : 'border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.04]',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <span>{String(block.index + 1).padStart(3, '0')}</span>
                <span>{typeLabel(block.type)}</span>
                {block.pageIdx !== null ? <span>P{block.pageIdx + 1}</span> : null}
              </div>
              {block.type === 'image' ? <ImageIcon className="h-3.5 w-3.5 text-zinc-500" /> : null}
            </div>
            <p className="mt-3 line-clamp-4 text-sm leading-6 text-zinc-200">{block.preview || '无文本内容'}</p>
          </button>
        ))}

        {filteredBlocks.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">
            当前筛选下没有匹配的结构块。
          </div>
        ) : null}
      </div>
    </section>
  )
}
