import { AlertCircle, BookMarked, Check, Download, LoaderCircle, Pencil, Save, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  deletePaperMemoryItem,
  fetchPaperMemory,
  patchPaperMemoryItem,
  postPaperMemoryItem,
  postPaperMemoryMarkdownExport,
} from '@/api'
import { MarkdownComment } from '@/components/MarkdownComment'
import type { MemoryItemType, PaperMemory, PaperMemoryItem } from '@/types'

export interface MemoryNoteSeed {
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
}

interface PaperMemoryPanelProps {
  open: boolean
  paperId: string
  paperTitle: string
  seed: MemoryNoteSeed | null
  focusItemId?: string | null
  refreshKey?: number
  onClose: () => void
  onSeedConsumed: () => void
  onLocateItem?: (item: PaperMemoryItem) => void
}

export function PaperMemoryPanel({
  open,
  paperId,
  paperTitle,
  seed,
  focusItemId = null,
  refreshKey = 0,
  onClose,
  onSeedConsumed,
  onLocateItem,
}: PaperMemoryPanelProps) {
  const [memory, setMemory] = useState<PaperMemory | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [noteType, setNoteType] = useState<MemoryItemType>('note')
  const [noteQuote, setNoteQuote] = useState<string | null>(null)
  const [tagText, setTagText] = useState('')
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<MemoryItemType>('note')
  const [editTagText, setEditTagText] = useState('')
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null)
  const [flashItemId, setFlashItemId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const consumedSeedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !paperId) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPaperMemory(paperId)
      .then((payload) => {
        if (!cancelled) {
          setMemory(payload)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '论文记忆加载失败')
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
  }, [open, paperId, refreshKey])

  useEffect(() => {
    if (!open || !seed) {
      return
    }

    const seedKey = [seed.quote, seed.contextBefore ?? '', seed.contextAfter ?? ''].join('\u0000')
    if (consumedSeedRef.current === seedKey) {
      onSeedConsumed()
      return
    }
    consumedSeedRef.current = seedKey
    const seededContent = buildSeededNoteContent(seed)
    setNoteContent((current) => (current.trim() ? `${current.trim()}\n\n${seededContent}` : seededContent))
    setNoteQuote(seed.quote)
    onSeedConsumed()
  }, [onSeedConsumed, open, seed])

  useEffect(() => {
    if (!seed) {
      consumedSeedRef.current = null
    }
  }, [seed])

  useEffect(() => {
    if (!open || !focusItemId || !memory) {
      return
    }

    const target = findMemoryItemElement(scrollContainerRef.current, focusItemId)
    if (!target) {
      return
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashItemId(focusItemId)
    const timeout = window.setTimeout(() => {
      setFlashItemId((current) => (current === focusItemId ? null : current))
    }, 2400)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [focusItemId, memory, open])

  const tags = useMemo(() => parseTags(tagText), [tagText])
  const editTags = useMemo(() => parseTags(editTagText), [editTagText])
  const memoryGroups = useMemo(() => {
    if (!memory) {
      return []
    }
    return [
      { key: 'insights', title: '关键洞察', items: memory.insights },
      { key: 'notes', title: '笔记', items: memory.notes },
      { key: 'questions', title: '问题', items: memory.questions },
      { key: 'actions', title: '行动项', items: memory.actions },
    ].filter((group) => group.items.length > 0)
  }, [memory])
  const visibleMemoryItems = memory?.items ?? []

  if (!open) {
    return null
  }

  async function handleSave() {
    const content = noteContent.trim()
    if (!content) {
      setError('先写下要沉淀的内容')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const nextMemory = await postPaperMemoryItem(paperId, {
        type: noteType,
        text: content,
        quote: noteQuote,
        tags,
      })
      setMemory(nextMemory)
      setNoteContent('')
      setNoteType('note')
      setNoteQuote(null)
      setTagText('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存笔记失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleExportMarkdown() {
    setExporting(true)
    setError(null)
    setExportNotice(null)
    try {
      const exported = await postPaperMemoryMarkdownExport(paperId)
      downloadMarkdownFile(exported.fileName, exported.markdown)
      setExportNotice(`已导出 ${exported.itemCount} 条记忆`)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Markdown 导出失败')
    } finally {
      setExporting(false)
    }
  }

  function handleEditStart(item: PaperMemoryItem) {
    setEditingItemId(item.id)
    setEditText(item.text || item.content)
    setEditType(item.type)
    setEditTagText(item.tags.join(', '))
    setError(null)
  }

  function handleEditCancel() {
    setEditingItemId(null)
    setEditText('')
    setEditType('note')
    setEditTagText('')
  }

  async function handleUpdateItem(item: PaperMemoryItem) {
    const text = editText.trim()
    if (!text) {
      setError('Memory text cannot be empty')
      return
    }

    setMutatingItemId(item.id)
    setError(null)
    try {
      const nextMemory = await patchPaperMemoryItem(paperId, item.id, {
        type: editType,
        text,
        tags: editTags,
      })
      setMemory(nextMemory)
      handleEditCancel()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Memory update failed')
    } finally {
      setMutatingItemId(null)
    }
  }

  async function handleDeleteItem(item: PaperMemoryItem) {
    setMutatingItemId(item.id)
    setError(null)
    try {
      setMemory(await deletePaperMemoryItem(paperId, item.id))
      if (editingItemId === item.id) {
        handleEditCancel()
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Memory delete failed')
    } finally {
      setMutatingItemId(null)
    }
  }

  return (
    <div className="cark-overlay fixed inset-0 z-[66] flex justify-end backdrop-blur-sm">
      <button type="button" aria-label="关闭论文记忆" className="flex-1" onClick={onClose} />
      <aside className="cark-panel cark-elevated flex h-full w-full max-w-[520px] flex-col border-l bg-[var(--surface-elevated)]">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-5 [border-color:var(--border-soft)]">
          <div className="min-w-0">
            <p className="cark-faint inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
              <BookMarked className="h-3.5 w-3.5" />
              论文记忆
            </p>
            <h2 className="cark-title mt-2 line-clamp-2 font-serif text-2xl">{paperTitle}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              title="导出 Markdown"
              aria-label="Export memory Markdown"
              disabled={exporting}
              onClick={() => void handleExportMarkdown()}
              className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={scrollContainerRef} className="reader-scroll cark-contained-scroll flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="mb-4 flex items-start gap-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {exportNotice ? (
            <div className="mb-4 rounded-[18px] border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
              {exportNotice}
            </div>
          ) : null}

          {loading ? (
            <div className="cark-card inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              正在加载论文记忆
            </div>
          ) : null}

          {memory ? (
            <div className="space-y-4">
              <section className="rounded-[22px] border border-[rgba(var(--accent-rgb),0.22)] bg-[rgba(var(--accent-rgb),0.07)] px-4 py-4">
                <p className="cark-faint text-xs uppercase tracking-[0.18em]">当前判断</p>
                <p className="cark-text mt-2 text-sm leading-7">{memory.summary}</p>
              </section>

              <MemoryList title="关键锚点" items={memory.anchors} />
              <MemoryList title="未解问题" items={memory.openQuestions} />
              <MemoryList title="下一步动作" items={memory.recommendedActions} />
            </div>
          ) : null}

          <section className="cark-card mt-5 rounded-[24px] p-4">
            <label className="cark-text grid gap-2 text-sm">
              新笔记
              <textarea
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                placeholder="写下真正值得留下的判断。不要复述论文。"
                className="cark-input min-h-[150px] resize-y rounded-[18px] px-3 py-3 text-sm leading-7 outline-none"
                aria-label="New memory text"
              />
            </label>

            <label className="cark-text mt-3 grid gap-2 text-sm">
              Type
              <select
                value={noteType}
                onChange={(event) => setNoteType(event.target.value as MemoryItemType)}
                className="cark-input rounded-[16px] px-3 py-2.5 text-sm outline-none"
                aria-label="New memory type"
              >
                <option value="note">Note</option>
                <option value="question">Question</option>
                <option value="action">Action</option>
                <option value="insight">Insight</option>
              </select>
            </label>

            {noteQuote ? (
              <div className="mt-3 rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-3">
                <p className="cark-faint text-[11px] uppercase tracking-[0.18em]">关联划线</p>
                <p className="cark-muted mt-1 line-clamp-3 text-xs leading-5">{noteQuote}</p>
              </div>
            ) : null}

            <label className="cark-text mt-3 grid gap-2 text-sm">
              标签
              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="方法, 风险, 证据"
                className="cark-input rounded-[16px] px-3 py-2.5 text-sm outline-none"
                aria-label="New memory tags"
              />
            </label>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="cark-faint text-xs">{tags.length > 0 ? `${tags.length} 个标签` : '标签可选'}</p>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="cark-button-accent inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Save new memory"
              >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存笔记
              </button>
            </div>
          </section>

          {memoryGroups.length > 0 ? (
            <section className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="cark-title font-serif text-xl">记忆分组</h3>
                <span className="cark-faint text-xs">{memoryGroups.length}</span>
              </div>
              {memoryGroups.map((group) => (
                <section key={group.key} className="rounded-[20px] border [border-color:var(--border-soft)] bg-[var(--surface-soft)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="cark-faint text-xs uppercase tracking-[0.18em]">{group.title}</p>
                    <span className="cark-chip-accent rounded-full px-2.5 py-1 text-[11px]">{group.items.length}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {group.items.slice(0, 3).map((item) => (
                      <p key={item.id} className="cark-text line-clamp-2 text-xs leading-5">
                        {item.text || item.content}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </section>
          ) : null}

          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="cark-title font-serif text-xl">最近沉淀</h3>
              <span className="cark-faint text-xs">{visibleMemoryItems.length}</span>
            </div>
            {memory && visibleMemoryItems.length > 0 ? (
              <div className="space-y-3">
                {visibleMemoryItems.map((note) => (
                  <article
                    key={note.id}
                    data-memory-item-id={note.id}
                    className={[
                      'cark-card rounded-[20px] px-4 py-4 transition',
                      note.id === flashItemId
                        ? 'border-[rgba(var(--accent-rgb),0.65)] bg-[rgba(var(--accent-rgb),0.10)] shadow-[0_0_0_2px_rgba(var(--accent-rgb),0.28)]'
                        : '',
                    ].join(' ')}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="cark-chip-accent rounded-full px-2.5 py-1 text-[11px] uppercase">
                        {note.type}
                      </span>
                      <div className="flex items-center gap-2">
                        {canLocateMemoryItem(note) && onLocateItem ? (
                          <button
                            type="button"
                            onClick={() => onLocateItem(note)}
                            className="cark-button-secondary rounded-full px-3 py-1.5 text-xs"
                          >
                            定位原文
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleEditStart(note)}
                          className="cark-button-secondary inline-flex h-8 w-8 items-center justify-center rounded-full"
                          aria-label="Edit memory"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={mutatingItemId === note.id}
                          onClick={() => void handleDeleteItem(note)}
                          className="cark-button-secondary inline-flex h-8 w-8 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Delete memory"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {note.quote ? (
                      <p className="cark-faint mb-3 line-clamp-2 border-l-2 border-[rgba(var(--accent-rgb),0.38)] pl-3 text-xs leading-5">
                        {note.quote}
                      </p>
                    ) : null}
                    {editingItemId === note.id ? (
                      <div className="grid gap-3">
                        <select
                          value={editType}
                          onChange={(event) => setEditType(event.target.value as MemoryItemType)}
                          className="cark-input rounded-[16px] px-3 py-2.5 text-sm outline-none"
                          aria-label="Memory type"
                        >
                          <option value="note">Note</option>
                          <option value="question">Question</option>
                          <option value="action">Action</option>
                          <option value="insight">Insight</option>
                        </select>
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          className="cark-input min-h-[120px] resize-y rounded-[18px] px-3 py-3 text-sm leading-7 outline-none"
                          aria-label="Memory text"
                        />
                        <input
                          value={editTagText}
                          onChange={(event) => setEditTagText(event.target.value)}
                          className="cark-input rounded-[16px] px-3 py-2.5 text-sm outline-none"
                          aria-label="Memory tags"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleEditCancel}
                            className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
                          >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={mutatingItemId === note.id}
                            onClick={() => void handleUpdateItem(note)}
                            className="cark-button-accent inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {mutatingItemId === note.id ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <MarkdownComment content={note.text || note.content} />
                    )}
                    {editingItemId !== note.id && note.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {note.tags.map((tag) => (
                          <span key={tag} className="cark-chip-accent rounded-full px-2.5 py-1 text-[11px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="cark-faint rounded-[20px] border border-dashed [border-color:var(--border-strong)] px-4 py-5 text-sm">
                还没有沉淀。选中一句真正刺眼的话，留下判断。
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}

function findMemoryItemElement(container: HTMLElement | null, itemId: string) {
  if (!container) {
    return null
  }
  return Array.from(container.querySelectorAll<HTMLElement>('[data-memory-item-id]')).find(
    (element) => element.dataset.memoryItemId === itemId,
  ) ?? null
}

function downloadMarkdownFile(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function MemoryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <section>
      <p className="cark-faint text-xs uppercase tracking-[0.18em]">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="cark-button-secondary rounded-full px-3 py-1.5 text-xs">
            {item}
          </span>
        ))}
      </div>
    </section>
  )
}

function buildSeededNoteContent(seed: MemoryNoteSeed) {
  return [
    seed.contextBefore ? `前文：${seed.contextBefore}` : '',
    `划线：${seed.quote}`,
    seed.contextAfter ? `后文：${seed.contextAfter}` : '',
    '判断：',
  ]
    .filter(Boolean)
    .join('\n')
}

function parseTags(value: string) {
  return value
    .split(/[,\s，、]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
}

function canLocateMemoryItem(item: PaperMemoryItem) {
  return Boolean(
    item.locator
    || item.sourceAnnotationId
    || item.blockId
    || item.quote
    || item.anchor?.quote
    || item.anchor?.contextBefore
    || item.anchor?.contextAfter,
  )
}
