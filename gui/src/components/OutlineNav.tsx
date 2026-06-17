import type { OutlineItem } from '@/types'

interface OutlineNavProps {
  outline: OutlineItem[]
  activeId: string | null
  onJump: (id: string) => void
}

export function OutlineNav({ outline, activeId, onJump }: OutlineNavProps) {
  if (outline.length === 0) {
    return (
      <div className="cark-faint rounded-[24px] border border-dashed [border-color:var(--border-strong)] bg-[var(--surface-input)] p-4 text-sm">
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
            'flex w-full items-start rounded-2xl px-3 py-2 text-left transition',
            activeId === item.id
              ? 'bg-[rgba(var(--accent-rgb),0.12)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]',
          ].join(' ')}
          style={{ paddingLeft: `${item.level * 10 + 10}px` }}
        >
          <span className="min-w-0 space-y-0.5">
            <span className="block line-clamp-2 text-[13px] font-medium leading-5 tracking-[0.01em]">
              {item.text}
            </span>
            {item.translatedText ? (
              <span
                className={[
                  'block line-clamp-2 text-[11px] leading-4',
                  activeId === item.id ? 'text-[rgba(var(--accent-rgb),0.78)]' : 'text-[var(--text-faint)]',
                ].join(' ')}
              >
                {item.translatedText}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </nav>
  )
}
