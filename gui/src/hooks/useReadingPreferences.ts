import { useEffect, useState } from 'react'

const FONT_SCALE_KEY = 'cark-reader-font-scale'
const MIN_SCALE = 0.85
const MAX_SCALE = 1.3
const STEP = 0.1

function readFontScale() {
  const stored = Number(window.localStorage.getItem(FONT_SCALE_KEY))
  return Number.isFinite(stored) && stored >= MIN_SCALE && stored <= MAX_SCALE ? stored : 1
}

export function useReadingPreferences() {
  const [fontScale, setFontScale] = useState(readFontScale)

  useEffect(() => {
    document.documentElement.style.setProperty('--reader-font-scale', String(fontScale))
    window.localStorage.setItem(FONT_SCALE_KEY, String(fontScale))
  }, [fontScale])

  return {
    fontScale,
    decreaseFont: () => setFontScale((value) => Math.max(MIN_SCALE, Number((value - STEP).toFixed(2)))),
    increaseFont: () => setFontScale((value) => Math.min(MAX_SCALE, Number((value + STEP).toFixed(2)))),
  }
}
