import { Moon, Sun } from 'lucide-react'

import { useTheme } from '@/hooks/useTheme'

export function ThemeSwitch() {
  const { mode, toggleTheme, background, setBackground, backgroundOptions } = useTheme()

  return (
    <div className="cark-panel flex flex-wrap items-center gap-2 rounded-full px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur">
      <button
        type="button"
        onClick={toggleTheme}
        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium"
      >
        {mode === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        {mode === 'dark' ? '切到日间' : '切到夜间'}
      </button>

      <div className="flex items-center gap-1">
        {backgroundOptions.map((item) => {
          const active = item.value === background
          return (
            <button
              key={item.value}
              type="button"
              aria-label={`切换到${item.label}背景`}
              aria-pressed={active}
              title={item.label}
              onClick={() => setBackground(item.value)}
              className={[
                'cark-theme-swatch inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
                active ? 'scale-105' : 'opacity-80 hover:opacity-100',
              ].join(' ')}
              data-background-swatch={item.value}
              data-active={active ? 'true' : 'false'}
            >
              <span className="sr-only">{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
