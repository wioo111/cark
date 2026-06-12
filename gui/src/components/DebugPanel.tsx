import { Copy, FolderOpen, Orbit, ScrollText, Send } from 'lucide-react'

import { postOpenAction } from '@/api'
import type { PaperDetail } from '@/types'

interface DebugPanelProps {
  detail: PaperDetail
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

async function openTarget(paperId: string, target: 'rootDir' | 'contentListJson' | 'linearized' | 'bilingual' | 'feishuReady') {
  await postOpenAction(paperId, target)
}

export function DebugPanel({ detail }: DebugPanelProps) {
  const pathItems = [
    { label: '文献根目录', value: detail.rootDir, target: 'rootDir' as const },
    { label: '结构树 JSON', value: detail.files.contentListJson, target: 'contentListJson' as const },
    { label: '结构化原文', value: detail.files.linearized, target: 'linearized' as const },
    { label: '中英双语稿', value: detail.files.bilingual, target: 'bilingual' as const },
  ].filter((item) => item.value)

  const stats = [
    ['解析块', detail.stats.blockCount],
    ['段落', detail.stats.paragraphCount],
    ['标题', detail.stats.headingCount],
    ['图片', detail.stats.imageCount],
    ['表格', detail.stats.tableCount],
    ['公式', detail.stats.formulaCount],
  ]

  return (
    <aside className="space-y-5">
      <section className="rounded-[28px] border border-emerald-300/10 bg-emerald-300/[0.02] p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-2 text-emerald-200">
            <Send className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-emerald-500/80">第三方平台整合</p>
            <h3 className="font-serif text-lg text-emerald-100/90">Lark Integration</h3>
          </div>
        </div>
        
        <div className="space-y-3">
          {detail.files.feishuReady ? (
            <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">专用格式源码</p>
              <p className="mt-2 break-all text-sm text-zinc-200">{detail.files.feishuReady}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => openTarget(detail.id, 'feishuReady')}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-300/10"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  打开
                </button>
                <button
                  type="button"
                  onClick={() => copyText(detail.files.feishuReady ?? '')}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/30 hover:text-zinc-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">
              还没有生成第三方发布稿。需要时再从命令行导出。
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-2 text-amber-200">
            <Orbit className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">解析引擎数据</p>
            <h3 className="font-serif text-lg text-zinc-100">结构化统计</h3>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-2 text-lg text-zinc-100">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl border border-sky-300/20 bg-sky-300/10 p-2 text-sky-200">
            <ScrollText className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">本地文件</p>
            <h3 className="font-serif text-lg text-zinc-100">路径与动作</h3>
          </div>
        </div>

        <div className="space-y-3">
          {pathItems.map((item) => (
            <div key={item.label} className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{item.label}</p>
              <p className="mt-2 break-all text-sm text-zinc-200">{item.value}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => openTarget(detail.id, item.target)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-amber-300/40 hover:text-amber-100"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  打开
                </button>
                <button
                  type="button"
                  onClick={() => copyText(item.value ?? '')}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/30 hover:text-zinc-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}
