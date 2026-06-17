import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'
export type ThemeBackground = 'amber' | 'ocean' | 'forest' | 'orchid'

const THEME_MODE_KEY = 'cark-theme-mode'
const THEME_BACKGROUND_KEY = 'cark-theme-background'

export const themeBackgroundOptions: Array<{ value: ThemeBackground; label: string }> = [
  { value: 'amber', label: '琥珀' },
  { value: 'ocean', label: '海蓝' },
  { value: 'forest', label: '森林' },
  { value: 'orchid', label: '兰雾' },
]

function getSystemThemeMode(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredThemeMode(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_MODE_KEY)
  return saved === 'light' || saved === 'dark' ? saved : getSystemThemeMode()
}

function readStoredThemeBackground(): ThemeBackground {
  const saved = window.localStorage.getItem(THEME_BACKGROUND_KEY)
  return themeBackgroundOptions.some((item) => item.value === saved)
    ? (saved as ThemeBackground)
    : 'amber'
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStoredThemeMode)
  const [background, setBackground] = useState<ThemeBackground>(readStoredThemeBackground)

  useEffect(() => {
    document.documentElement.dataset.themeMode = mode
    document.documentElement.dataset.themeBackground = background
    window.localStorage.setItem(THEME_MODE_KEY, mode)
    window.localStorage.setItem(THEME_BACKGROUND_KEY, background)
  }, [background, mode])

  return {
    theme: mode,
    mode,
    setMode,
    background,
    setBackground,
    toggleTheme: () => setMode((current) => (current === 'light' ? 'dark' : 'light')),
    isDark: mode === 'dark',
    backgroundOptions: themeBackgroundOptions,
  }
}
