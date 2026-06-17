import { AlertCircle, BookMarked, LoaderCircle, Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { fetchPaperMemory, postPaperNote } from '@/api'
import { MarkdownComment } from '@/components/MarkdownComment'
import type { PaperMemory } from '@/types'

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
  onClose: () => void
  onSeedConsumed: () => void
}

export function PaperMemoryPanel({
  open,
  paperId,
  paperTitle,
  seed,
  onClose,
  onSeedConsumed,
}: PaperMemoryPanelProps) {
  const [memory, setMemory] = useState<PaperMemory | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [noteQuote, setNoteQuote] = useState<string | null>(null)
  const [tagText, setTagText] = useState('')
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
  }, [open, paperId])

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

  const tags = useMemo(() => parseTags(tagText), [tagText])

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
      const nextMemory = await postPaperNote(paperId, {
        content,
        quote: noteQuote,
        tags,
      })
      setMemory(nextMemory)
      setNoteContent('')
      setNoteQuote(null)
      setTagText('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存笔记失败')
    } finally {
      setSaving(false)
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
          <button
            type="button"
            onClick={onClose}
            className="cark-button-secondary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="reader-scroll cark-contained-scroll flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="mb-4 flex items-start gap-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
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
              />
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
              />
            </label>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="cark-faint text-xs">{tags.length > 0 ? `${tags.length} 个标签` : '标签可选'}</p>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="cark-button-accent inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存笔记
              </button>
            </div>
          </section>

          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="cark-title font-serif text-xl">最近沉淀</h3>
              <span className="cark-faint text-xs">{memory?.noteCount ?? 0}</span>
            </div>
            {memory && memory.recentNotes.length > 0 ? (
              <div className="space-y-3">
                {memory.recentNotes.map((note) => (
                  <article key={note.id} className="cark-card rounded-[20px] px-4 py-4">
                    {note.quote ? (
                      <p className="cark-faint mb-3 line-clamp-2 border-l-2 border-[rgba(var(--accent-rgb),0.38)] pl-3 text-xs leading-5">
                        {note.quote}
                      </p>
                    ) : null}
                    <MarkdownComment content={note.content} />
                    {note.tags.length > 0 ? (
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
