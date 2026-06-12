import { Bot, Brain, FileText, RefreshCw, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { fetchPaperMemory, postPaperNote } from '@/api'
import { BlockLocatorPanel } from '@/components/BlockLocatorPanel'
import { DebugPanel } from '@/components/DebugPanel'
import { ImageGallery } from '@/components/ImageGallery'
import type { PaperDetail } from '@/types'

interface CortexCopilotProps {
  detail: PaperDetail
  selectedBlockId: string | null
  locatorStatus: 'idle' | 'matched' | 'failed'
  onSelectBlock: (blockId: string) => void
}

export function CortexCopilot({ detail, selectedBlockId, locatorStatus, onSelectBlock }: CortexCopilotProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'notes' | 'memory' | 'inspect'>('chat')
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memory, setMemory] = useState<Awaited<ReturnType<typeof fetchPaperMemory>> | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const selectedBlock = useMemo(
    () => detail.blocks.find((block) => block.id === selectedBlockId) ?? null,
    [detail.blocks, selectedBlockId],
  )
  const contextualPrompts = useMemo(() => {
    if (selectedBlock) {
      return [
        '这段真正提出了什么主张？',
        '它和全文核心贡献的关系是什么？',
        '这里最值得沉淀成长期知识的点是什么？',
      ]
    }
    return [
      '先从当前论文提炼一个值得长期保留的判断',
      '记录一个你不同意或仍存疑的地方',
      '标记一个能迁移到你现有系统的方法或概念',
    ]
  }, [selectedBlock])

  useEffect(() => {
    let cancelled = false
    setMemoryLoading(true)
    setMemoryError(null)

    fetchPaperMemory(detail.id)
      .then((payload) => {
        if (!cancelled) {
          setMemory(payload)
          setMemoryLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMemoryError(error instanceof Error ? error.message : '加载论文记忆失败')
          setMemoryLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [detail.id])

  async function refreshMemory() {
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      setMemory(await fetchPaperMemory(detail.id))
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : '加载论文记忆失败')
    } finally {
      setMemoryLoading(false)
    }
  }

  async function handleSaveNote() {
    if (!draft.trim()) {
      setSaveError('先写下你的判断，再保存到论文记忆。')
      return
    }

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      const payload = await postPaperNote(detail.id, {
        content: draft.trim(),
        blockId: selectedBlock?.id ?? null,
        blockPreview: selectedBlock?.preview ?? null,
        quote: selectedBlock?.matchText ?? selectedBlock?.preview ?? null,
      })
      setMemory(payload)
      setDraft('')
      setSaveSuccess('已写入论文记忆。')
      setActiveTab('memory')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存笔记失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="flex flex-col rounded-[28px] border border-white/10 bg-white/[0.03]">
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={[
            'inline-flex flex-1 items-center justify-center gap-2 rounded-[18px] py-2.5 text-sm transition',
            activeTab === 'chat' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300',
          ].join(' ')}
        >
          <Bot className="h-4 w-4" />
          共读对话
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('notes')}
          className={[
            'inline-flex flex-1 items-center justify-center gap-2 rounded-[18px] py-2.5 text-sm transition',
            activeTab === 'notes' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300',
          ].join(' ')}
        >
          <FileText className="h-4 w-4" />
          笔记
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('memory')}
          className={[
            'inline-flex flex-1 items-center justify-center gap-2 rounded-[18px] py-2.5 text-sm transition',
            activeTab === 'memory' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300',
          ].join(' ')}
        >
          <Brain className="h-4 w-4" />
          记忆
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('inspect')}
          className={[
            'inline-flex flex-1 items-center justify-center gap-2 rounded-[18px] py-2.5 text-sm transition',
            activeTab === 'inspect' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300',
          ].join(' ')}
        >
          <Wrench className="h-4 w-4" />
          工程
        </button>
      </div>

      <div className="p-4">
        {activeTab === 'chat' ? (
          <div className="space-y-5">
            <section className="rounded-[24px] border border-sky-300/15 bg-sky-300/[0.04] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-sky-300/70">Context</p>
                  <h3 className="mt-1 font-serif text-lg text-zinc-100">当前共读上下文</h3>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshMemory()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
                >
                  <RefreshCw className={['h-3.5 w-3.5', memoryLoading ? 'animate-spin' : ''].join(' ')} />
                  刷新
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">当前论文</p>
                  <p className="mt-2 text-sm leading-7 text-zinc-200">{detail.title}</p>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">当前定位</p>
                  {selectedBlock ? (
                    <div className="space-y-3">
                      <p className="text-sm leading-7 text-zinc-200">{selectedBlock.preview}</p>
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span>块 {selectedBlock.index + 1}</span>
                        <span>{locatorStatus === 'matched' ? '正文已定位' : locatorStatus === 'failed' ? '正文待匹配' : '待定位'}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-7 text-zinc-500">从右侧结构块或正文中选定一个位置，再围绕它共读。</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Prompts</p>
              <h3 className="mt-1 font-serif text-lg text-zinc-100">下一步可以怎么问</h3>
              <div className="mt-4 space-y-3">
                {contextualPrompts.map((prompt) => (
                  <div key={prompt} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm leading-7 text-zinc-200">
                    {prompt}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Memory</p>
              <h3 className="mt-1 font-serif text-lg text-zinc-100">论文记忆概况</h3>
              {memoryLoading ? (
                <p className="mt-4 text-sm text-zinc-500">正在整理这篇论文的记忆卡。</p>
              ) : memoryError ? (
                <p className="mt-4 text-sm text-rose-200">{memoryError}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="text-sm leading-7 text-zinc-300">{memory?.summary}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">累计笔记</p>
                      <p className="mt-2 text-lg text-zinc-100">{memory?.noteCount ?? 0}</p>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">最近更新</p>
                      <p className="mt-2 text-sm text-zinc-100">{formatTimeLabel(memory?.lastUpdated)}</p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : activeTab === 'notes' ? (
          <div className="space-y-5">
            <section className="rounded-[24px] border border-amber-300/15 bg-amber-300/[0.04] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-amber-300/70">Capture</p>
              <h3 className="mt-1 font-serif text-lg text-zinc-100">写入论文笔记</h3>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                先记判断，不求完整。后续再从笔记里提纯稳定观点和跨论文连接。
              </p>
              {selectedBlock ? (
                <div className="mt-4 rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">绑定位置</p>
                  <p className="mt-2 text-sm leading-7 text-zinc-200">{selectedBlock.preview}</p>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="写下你的判断、疑问、迁移思路或反驳点"
                className="mt-4 h-40 w-full resize-none rounded-[20px] border border-white/10 bg-black/25 px-4 py-4 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-300/35"
              />
              {saveError ? <p className="mt-3 text-sm text-rose-200">{saveError}</p> : null}
              {saveSuccess ? <p className="mt-3 text-sm text-emerald-200">{saveSuccess}</p> : null}
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  {selectedBlock ? '保存后会自动绑定当前结构块。' : '未绑定具体结构块，仍会归档到当前论文。'}
                </p>
                <button
                  type="button"
                  onClick={() => void handleSaveNote()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-sm text-amber-100 transition hover:border-amber-300/45 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileText className="h-4 w-4" />
                  {saving ? '写入中' : '保存笔记'}
                </button>
              </div>
            </section>

            <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Recent Notes</p>
              <h3 className="mt-1 font-serif text-lg text-zinc-100">最近写下的判断</h3>
              <div className="mt-4 space-y-3">
                {memory?.recentNotes.length ? (
                  memory.recentNotes.map((note) => (
                    <article key={note.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{formatTimeLabel(note.updatedAt)}</p>
                        {note.blockId ? (
                          <button
                            type="button"
                            onClick={() => onSelectBlock(note.blockId!)}
                            className="text-xs text-amber-200 transition hover:text-amber-100"
                          >
                            回到原文
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-zinc-200">{note.content}</p>
                      {note.blockPreview ? <p className="mt-3 text-xs leading-6 text-zinc-500">{note.blockPreview}</p> : null}
                    </article>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm text-zinc-500">
                    这篇论文还没有沉淀任何笔记。
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : activeTab === 'memory' ? (
          <div className="space-y-5">
            <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Memory Card</p>
                  <h3 className="mt-1 font-serif text-lg text-zinc-100">论文长期记忆</h3>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshMemory()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
                >
                  <RefreshCw className={['h-3.5 w-3.5', memoryLoading ? 'animate-spin' : ''].join(' ')} />
                  刷新
                </button>
              </div>
              {memoryLoading ? (
                <p className="mt-4 text-sm text-zinc-500">正在整理论文记忆。</p>
              ) : memoryError ? (
                <p className="mt-4 text-sm text-rose-200">{memoryError}</p>
              ) : (
                <div className="mt-4 space-y-5">
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">摘要</p>
                    <p className="mt-2 text-sm leading-7 text-zinc-200">{memory?.summary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">记忆锚点</p>
                      <div className="mt-3 space-y-2">
                        {memory?.anchors.length ? (
                          memory.anchors.map((anchor) => (
                            <p key={anchor} className="text-sm leading-7 text-zinc-200">{anchor}</p>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">还没有形成稳定锚点。</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">待解问题</p>
                      <div className="mt-3 space-y-2">
                        {memory?.openQuestions.map((question) => (
                          <p key={question} className="text-sm leading-7 text-zinc-200">{question}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">建议动作</p>
                    <div className="mt-3 space-y-2">
                      {memory?.recommendedActions.map((item) => (
                        <p key={item} className="text-sm leading-7 text-zinc-200">{item}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-6">
            <DebugPanel detail={detail} />
            <BlockLocatorPanel
              blocks={detail.blocks}
              selectedBlockId={selectedBlockId}
              locatorStatus={locatorStatus}
              onSelectBlock={onSelectBlock}
            />

            <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-4">
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">图片索引</p>
                <h2 className="mt-1 font-serif text-xl text-zinc-100">本地图片</h2>
              </div>
              <ImageGallery detail={detail} />
            </section>
          </div>
        )}
      </div>
    </aside>
  )
}

function formatTimeLabel(value: string | null | undefined) {
  if (!value) {
    return '尚无记录'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
