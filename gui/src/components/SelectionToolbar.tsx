import { AlertCircle, BookMarked, Bot, Copy, MessageSquarePlus, Search } from 'lucide-react'

interface SelectionToolbarProps {
  x: number
  y: number
  onCopy: () => void
  onSearch: () => void
  onComment: () => void
  onExplain: () => void
  onCritique: () => void
  onMemoryCandidate: () => void
  agentActionsDisabled?: boolean
}

export function SelectionToolbar({
  x,
  y,
  onCopy,
  onSearch,
  onComment,
  onExplain,
  onCritique,
  onMemoryCandidate,
  agentActionsDisabled = false,
}: SelectionToolbarProps) {
  const actionClassName =
    'cark-button-secondary inline-flex items-center gap-2 rounded-full bg-[var(--surface-input)] px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45'

  return (
    <div
      className="cark-panel cark-elevated fixed z-[60] flex max-w-[min(calc(100vw-1rem),760px)] flex-wrap items-center justify-center gap-2 rounded-[20px] px-2 py-2 backdrop-blur"
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
      <button
        type="button"
        onClick={onExplain}
        disabled={agentActionsDisabled}
        title={agentActionsDisabled ? '先在设置里配置可用共读助手' : '解释'}
        className={actionClassName}
      >
        <Bot className="h-3.5 w-3.5" />
        解释
      </button>
      <button
        type="button"
        onClick={onCritique}
        disabled={agentActionsDisabled}
        title={agentActionsDisabled ? '先在设置里配置可用共读助手' : '质疑'}
        className={actionClassName}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        质疑
      </button>
      <button
        type="button"
        onClick={onMemoryCandidate}
        disabled={agentActionsDisabled}
        title={agentActionsDisabled ? '先在设置里配置可用共读助手' : '沉淀'}
        className={actionClassName}
      >
        <BookMarked className="h-3.5 w-3.5" />
        沉淀
      </button>
    </div>
  )
}
