import { AlertCircle, ArrowLeft, BookMarked, FolderOpen, PanelLeft, RefreshCw, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { OutlineNav } from '@/components/OutlineNav'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import type { PaperAnnotation, PaperDetail, PaperView } from '@/types'
import { formatUpdatedAt } from '@/utils/paper'

const viewOptions: Array<{ key: PaperView; label: string }> = [
  { key: 'linearized', label: '原文' },
  { key: 'bilingual', label: '译文版本' },
]

export function ReaderPageLoading() {
  return (
    <main className="cark-page min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1600px] items-center justify-center">
        <div className="cark-panel cark-text inline-flex items-center gap-3 rounded-full px-5 py-3 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          正在加载论文
        </div>
      </div>
    </main>
  )
}

export function ReaderPageError({ error }: { error: string }) {
  return (
    <main className="cark-page min-h-screen px-6 py-6">
      <div className="mx-auto max-w-[800px] rounded-[30px] border border-rose-400/20 bg-rose-400/10 p-8">
        <p className="text-sm text-rose-100">{error}</p>
        <Link to="/" className="cark-button-secondary mt-6 inline-flex rounded-full px-4 py-2 text-sm">
          返回列表
        </Link>
      </div>
    </main>
  )
}

export function ReaderFloatingActions({
  onOpenOutline,
}: {
  onOpenOutline: () => void
}) {
  return (
    <>
      <Link
        to="/"
        className="cark-panel cark-elevated fixed bottom-5 left-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm backdrop-blur transition hover:border-[rgba(var(--accent-rgb),0.28)] xl:left-8"
      >
        <ArrowLeft className="h-4 w-4" />
        返回文献库
      </Link>

      <button
        type="button"
        onClick={onOpenOutline}
        className="cark-panel cark-elevated fixed left-0 top-1/2 z-40 inline-flex h-14 w-12 -translate-y-1/2 items-center justify-center rounded-r-[18px] border-l-0 backdrop-blur transition hover:w-14 hover:border-[rgba(var(--accent-rgb),0.28)] xl:h-16 xl:w-14"
        aria-label="打开目录"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
    </>
  )
}

export function ReaderStatusToasts({
  annotationError,
  readingStateError,
  memoryNotice,
  onClearErrors,
}: {
  annotationError: string | null
  readingStateError: string | null
  memoryNotice: string | null
  onClearErrors: () => void
}) {
  return (
    <>
      {annotationError || readingStateError ? (
        <div className="fixed right-4 top-4 z-[70] flex max-w-[460px] items-start gap-3 rounded-[20px] border border-rose-400/25 bg-[#2a1115]/95 px-4 py-3 text-sm text-rose-100 shadow-[0_20px_70px_rgba(0,0,0,0.4)] backdrop-blur">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            {annotationError ? <p>{annotationError}</p> : null}
            {readingStateError ? <p>{readingStateError}</p> : null}
          </div>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={onClearErrors}
            className="ml-auto text-rose-200/70 transition hover:text-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {memoryNotice ? (
        <div className="fixed right-4 top-4 z-[69] flex max-w-[420px] items-center gap-3 rounded-[20px] border border-emerald-300/25 bg-[#10251b]/95 px-4 py-3 text-sm text-emerald-100 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur">
          <BookMarked className="h-4 w-4 shrink-0" />
          <span>{memoryNotice}</span>
        </div>
      ) : null}
    </>
  )
}

export function ReaderOutlineSheet({
  open,
  outline,
  activeSectionId,
  onClose,
  onJump,
}: {
  open: boolean
  outline: Array<{ id: string; level: number; text: string }>
  activeSectionId: string | null
  onClose: () => void
  onJump: (id: string) => void
}) {
  if (!open) {
    return null
  }

  return (
    <>
      <button
        type="button"
        aria-label="关闭目录"
        onClick={onClose}
        className="cark-overlay fixed inset-0 z-40 backdrop-blur-[2px]"
      />
      <aside className="cark-panel cark-elevated fixed bottom-4 left-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col rounded-[28px] p-4 backdrop-blur xl:bottom-6 xl:left-6 xl:top-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="cark-faint text-xs uppercase tracking-[0.22em]">目录</p>
            <h2 className="cark-title mt-1 font-serif text-xl">章节导航</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="reader-scroll flex-1 overflow-y-auto pr-1">
          <OutlineNav outline={outline} activeId={activeSectionId} onJump={onJump} />
        </div>
      </aside>
    </>
  )
}

export function ReaderHeader({
  detail,
  activeView,
  onOpenRootDir,
  onOpenMemory,
  onSetView,
}: {
  detail: PaperDetail
  activeView: PaperView
  onOpenRootDir: () => void
  onOpenMemory: () => void
  onSetView: (view: PaperView) => void
}) {
  return (
    <header className="cark-theme-header rounded-[32px] px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="space-y-3">
          <div>
            <h1 className="cark-title max-w-5xl text-balance font-serif text-3xl leading-tight">{detail.title}</h1>
            <p className="cark-muted mt-2 text-sm">
              {detail.taskId ? `任务 ${detail.taskId} · ` : ''}
              更新于 {formatUpdatedAt(detail.updatedAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ThemeSwitch />
          <button
            type="button"
            onClick={onOpenRootDir}
            className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
          >
            <FolderOpen className="h-4 w-4" />
            打开目录
          </button>
          <button
            type="button"
            onClick={onOpenMemory}
            className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
          >
            <BookMarked className="h-4 w-4" />
            论文记忆
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {viewOptions
          .filter((item) => detail.availableViews.includes(item.key))
          .map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSetView(item.key)}
              className={[
                'rounded-full px-4 py-2 text-sm transition',
                item.key === activeView ? 'cark-button-accent' : 'cark-button-secondary bg-[var(--surface-input)]',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
      </div>
    </header>
  )
}

export function ReaderHighlightLayer({
  searchHighlightRects,
  searchHighlightTop,
  searchHighlightHeight,
  flashSearchHighlight,
  articleShellWidth,
  annotationHighlights,
  positionedAnnotations,
  activeView,
  flashAnnotationId,
}: {
  searchHighlightRects: Array<{ top: number; left: number; width: number; height: number }>
  searchHighlightTop: number | null
  searchHighlightHeight: number | null
  flashSearchHighlight: boolean
  articleShellWidth: number
  annotationHighlights: Array<{ annotationId: string; rects: Array<{ top: number; left: number; width: number; height: number }> }>
  positionedAnnotations: PaperAnnotation[]
  activeView: PaperView
  flashAnnotationId: string | null
}) {
  const effectiveSearchRects =
    searchHighlightRects.length > 0
      ? searchHighlightRects
      : searchHighlightTop !== null && searchHighlightHeight !== null
        ? [{ top: searchHighlightTop, left: 24, width: Math.max(articleShellWidth - 48, 48), height: searchHighlightHeight }]
        : []

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {effectiveSearchRects.map((rect, index) => (
        <div
          key={`search-highlight-${index}`}
          className={[
            'absolute rounded-[10px] transition-all',
            flashSearchHighlight
              ? 'bg-[rgba(var(--accent-rgb),0.16)] shadow-[0_0_22px_rgba(var(--accent-rgb),0.24)]'
              : 'bg-[rgba(var(--accent-rgb),0.1)]',
          ].join(' ')}
          style={{
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${Math.max(rect.height, 24)}px`,
          }}
        />
      ))}
      {annotationHighlights
        .filter((item) => positionedAnnotations.find((annotation) => annotation.id === item.annotationId)?.view === activeView)
        .flatMap((item) =>
          item.rects.map((rect, index) => (
            <div
              key={`${item.annotationId}-${index}`}
              className={[
                'absolute rounded-full transition-all',
                item.annotationId === flashAnnotationId
                  ? 'bg-[rgba(var(--accent-rgb),0.85)] shadow-[0_0_18px_rgba(var(--accent-rgb),0.35)]'
                  : 'bg-[rgba(var(--accent-rgb),0.58)]',
              ].join(' ')}
              style={{
                top: `${rect.top + Math.max(rect.height - (item.annotationId === flashAnnotationId ? 4 : 3), 0)}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${item.annotationId === flashAnnotationId ? 3 : 2}px`,
              }}
            />
          )),
        )}
    </div>
  )
}
