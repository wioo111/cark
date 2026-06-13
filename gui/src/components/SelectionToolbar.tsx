import { Copy, MessageSquarePlus, Search } from 'lucide-react'

interface SelectionToolbarProps {
  x: number
  y: number
  onCopy: () => void
  onSearch: () => void
  onComment: () => void
}

export function SelectionToolbar({ x, y, onCopy, onSearch, onComment }: SelectionToolbarProps) {
  const actionClassName =
    'inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 transition hover:border-white/25 hover:text-zinc-50'

  return (
    <div
      className="fixed z-[60] flex items-center gap-2 rounded-[20px] border border-white/10 bg-[#0f1117]/95 px-2 py-2 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur"
      style={{ left: `${x}px`, top: `${y}px`, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={onCopy} className={actionClassName}>
        <Copy className="h-3.5 w-3.5" />
        复制
      </button>
      <button type="button" onClick={onSearch} className={actionClassName}>
        <Search className="h-3.5 w-3.5" />
        搜索
      </button>
      <button type="button" onClick={onComment} className={actionClassName}>
        <MessageSquarePlus className="h-3.5 w-3.5" />
        添加评论
      </button>
    </div>
  )
}
