import { BookMarked, Copy, MessageSquarePlus, Search } from 'lucide-react'

interface SelectionToolbarProps {
  x: number
  y: number
  onCopy: () => void
  onSearch: () => void
  onComment: () => void
  onNote: () => void
}

export function SelectionToolbar({ x, y, onCopy, onSearch, onComment, onNote }: SelectionToolbarProps) {
  const actionClassName =
    'cark-button-secondary inline-flex items-center gap-2 rounded-full bg-[var(--surface-input)] px-3 py-2 text-xs'

  return (
    <div
      className="cark-panel cark-elevated fixed z-[60] flex items-center gap-2 rounded-[20px] px-2 py-2 backdrop-blur"
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
      <button type="button" onClick={onNote} className={actionClassName}>
        <BookMarked className="h-3.5 w-3.5" />
        记笔记
      </button>
    </div>
  )
}
