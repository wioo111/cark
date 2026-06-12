import type { OutlineItem } from '@/types'

interface OutlineNavProps {
  outline: OutlineItem[]
  activeId: string | null
  onJump: (id: string) => void
}

export function OutlineNav({ outline, activeId, onJump }: OutlineNavProps) {
  if (outline.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">
        当前视图没有标题层级，无法生成目录。
      </div>
    )
  }

  return (
    <nav className="space-y-2">
      {outline.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onJump(item.id)}
          className={[
            'flex w-full items-start rounded-2xl px-3 py-2 text-left text-sm transition',
            activeId === item.id
              ? 'bg-amber-300/10 text-amber-100'
              : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100',
          ].join(' ')}
          style={{ paddingLeft: `${item.level * 10 + 10}px` }}
        >
          <span className="line-clamp-2">{item.text}</span>
        </button>
      ))}
    </nav>
  )
}
