import { AlertCircle, BookOpen, LoaderCircle, Search, X } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'

import {
  fetchZoteroPapers,
  fetchZoteroStatus,
  postImportZoteroPaper,
} from '@/api'
import type { ProcessingTask, ZoteroPaper, ZoteroStatus } from '@/types'

interface ZoteroImportDialogProps {
  open: boolean
  onClose: () => void
  onImported: (task: ProcessingTask) => void
}

export function ZoteroImportDialog({
  open,
  onClose,
  onImported,
}: ZoteroImportDialogProps) {
  const [status, setStatus] = useState<ZoteroStatus | null>(null)
  const [papers, setPapers] = useState<ZoteroPaper[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importingKey, setImportingKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchZoteroStatus()
      .then(async (nextStatus) => {
        if (cancelled) {
          return
        }
        setStatus(nextStatus)
        if (!nextStatus.available) {
          setPapers([])
          return
        }
        const nextPapers = await fetchZoteroPapers()
        if (!cancelled) {
          setPapers(nextPapers)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '无法读取 Zotero')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) {
    return null
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      setPapers(await fetchZoteroPapers(query))
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : '搜索 Zotero 失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport(paper: ZoteroPaper) {
    setImportingKey(paper.attachmentKey)
    setError(null)
    try {
      const task = await postImportZoteroPaper(paper.attachmentKey)
      setPapers((current) =>
        current.map((item) =>
          item.attachmentKey === paper.attachmentKey
            ? { ...item, imported: true, taskId: task.id }
            : item,
        ),
      )
      onImported(task)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '从 Zotero 导入失败')
    } finally {
      setImportingKey(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭 Zotero 导入"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <section
        id="zotero-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zotero-import-title"
        className="relative z-10 flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-3xl flex-col rounded-[30px] border border-white/10 bg-[#0f1014] p-5 text-zinc-100 shadow-[0_24px_100px_rgba(0,0,0,0.5)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">只读连接</p>
            <h2 id="zotero-import-title" className="mt-1 font-serif text-2xl text-zinc-100">从 Zotero 导入</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Zotero 只提供原始 PDF。阅读进度、译文和批注全部保存在 cark。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {status?.available ? (
          <form onSubmit={(event) => void handleSearch(event)} className="mt-5 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、作者或年份"
                className="w-full rounded-full border border-white/10 bg-black/20 py-2.5 pl-11 pr-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-white/25 hover:text-zinc-100 disabled:opacity-50"
            >
              搜索
            </button>
          </form>
        ) : null}

        {error ? (
          <div className="mt-4 flex items-start gap-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {status && !status.available ? (
          <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/[0.07] p-5 text-sm leading-7 text-amber-100">
            <p>{status.message}</p>
            <p className="mt-2 text-amber-100/70">
              cark 不读取 Zotero 数据库，也不会修改 Zotero 中的论文和批注。
            </p>
          </div>
        ) : null}

        <div className="reader-scroll mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              正在读取 Zotero
            </div>
          ) : null}

          {!loading && status?.available && papers.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-white/10 px-5 py-10 text-center text-sm text-zinc-500">
              没有找到带 PDF 附件的论文。
            </div>
          ) : null}

          {!loading && papers.length > 0 ? (
            <div className="space-y-2">
              {papers.map((paper) => {
                const importing = importingKey === paper.attachmentKey
                const metadata = [...paper.creators, paper.year].filter(Boolean).join(' · ')
                return (
                  <article
                    key={paper.attachmentKey}
                    className="flex items-center justify-between gap-4 rounded-[20px] border border-white/8 bg-black/15 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <h3 className="line-clamp-2 text-sm font-medium text-zinc-100">{paper.title}</h3>
                      {metadata ? <p className="mt-1 truncate text-xs text-zinc-500">{metadata}</p> : null}
                      <p className="mt-1 truncate text-xs text-zinc-600">{paper.fileName}</p>
                    </div>
                    <button
                      type="button"
                      disabled={paper.imported || importing}
                      onClick={() => void handleImport(paper)}
                      className={[
                        'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm transition disabled:cursor-default',
                        paper.imported
                          ? 'border border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                          : 'border border-white/10 text-zinc-300 hover:border-white/25 hover:text-zinc-100',
                      ].join(' ')}
                    >
                      {importing ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <BookOpen className="h-4 w-4" />
                      )}
                      {paper.imported ? '已导入' : importing ? '导入中' : '导入'}
                    </button>
                  </article>
                )
              })}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
