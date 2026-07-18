import { useState } from 'react'
import { ArrowLeft, BookOpenText, Check, Download, List, LoaderCircle, MoonStar, Type, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ThemeSwitch } from '@/components/ThemeSwitch'
import { useReadingPreferences } from '@/hooks/useReadingPreferences'
import type { PaperView } from '@/types'

interface MobileReaderDockProps {
  activeView: PaperView
  availableViews: PaperView[]
  offlineStatus: 'idle' | 'downloading' | 'ready' | 'error'
  onOpenOutline: () => void
  onSetView: (view: PaperView) => void
  onDownload: () => void
}

export function MobileReaderDock({
  activeView,
  availableViews,
  offlineStatus,
  onOpenOutline,
  onSetView,
  onDownload,
}: MobileReaderDockProps) {
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const { fontScale, decreaseFont, increaseFont } = useReadingPreferences()
  const canSwitchView = availableViews.includes('bilingual')
  const nextView: PaperView = activeView === 'bilingual' ? 'linearized' : 'bilingual'

  return (
    <>
      {appearanceOpen ? (
        <div className="cark-mobile-reader-sheet fixed inset-x-3 z-[55] rounded-[26px] p-4 sm:left-auto sm:w-[390px]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="cark-faint text-xs uppercase tracking-[0.2em]">阅读外观</p>
              <p className="cark-title mt-1 text-sm font-medium">字号、日夜和背景</p>
            </div>
            <button type="button" onClick={() => setAppearanceOpen(false)} className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full" aria-label="关闭阅读设置">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-4 flex items-center justify-between rounded-2xl border px-3 py-2 [border-color:var(--border-soft)]">
            <span className="cark-muted inline-flex items-center gap-2 text-sm"><Type className="h-4 w-4" />正文字号</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={decreaseFont} className="cark-button-secondary h-10 w-10 rounded-full text-sm" aria-label="缩小字号">A−</button>
              <span className="cark-faint w-10 text-center text-xs">{Math.round(fontScale * 100)}%</span>
              <button type="button" onClick={increaseFont} className="cark-button-secondary h-10 w-10 rounded-full text-base" aria-label="放大字号">A+</button>
            </div>
          </div>
          <ThemeSwitch />
        </div>
      ) : null}

      <nav className="cark-mobile-reader-dock fixed inset-x-3 z-50 grid grid-cols-5 rounded-[24px] px-2 py-2 xl:hidden" aria-label="移动阅读工具栏">
        <Link to="/" className="cark-mobile-reader-action"><ArrowLeft className="h-5 w-5" /><span>书架</span></Link>
        <button type="button" onClick={onOpenOutline} className="cark-mobile-reader-action"><List className="h-5 w-5" /><span>目录</span></button>
        <button type="button" disabled={!canSwitchView} onClick={() => onSetView(nextView)} className="cark-mobile-reader-action disabled:opacity-40">
          <BookOpenText className="h-5 w-5" /><span>{activeView === 'bilingual' ? '看原文' : '看译文'}</span>
        </button>
        <button type="button" disabled={offlineStatus === 'downloading'} onClick={onDownload} className="cark-mobile-reader-action">
          {offlineStatus === 'downloading' ? <LoaderCircle className="h-5 w-5 animate-spin" /> : offlineStatus === 'ready' ? <Check className="h-5 w-5" /> : <Download className="h-5 w-5" />}
          <span>{offlineStatus === 'ready' ? '已离线' : offlineStatus === 'error' ? '重试' : '离线'}</span>
        </button>
        <button type="button" onClick={() => setAppearanceOpen((value) => !value)} className="cark-mobile-reader-action" aria-expanded={appearanceOpen}>
          <MoonStar className="h-5 w-5" /><span>外观</span>
        </button>
      </nav>
    </>
  )
}
