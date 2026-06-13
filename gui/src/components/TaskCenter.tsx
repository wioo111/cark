import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'

import type { ProcessingTask } from '@/types'

interface TaskCenterProps {
  tasks: ProcessingTask[]
  loading: boolean
  retryingTaskId: string | null
  onRetry: (taskId: string) => void
  onOpenPaper: (task: ProcessingTask) => void
  onOpenSettings: () => void
}

const statusLabels: Record<ProcessingTask['status'], string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

export function TaskCenter({
  tasks,
  loading,
  retryingTaskId,
  onRetry,
  onOpenPaper,
  onOpenSettings,
}: TaskCenterProps) {
  return (
    <aside className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-zinc-100">任务</h2>
          <p className="mt-1 text-xs text-zinc-500">上传后的进度和历史会保留在这里。</p>
        </div>
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500" /> : null}
      </div>

      <div className="mt-4 space-y-3">
        {tasks.length > 0 ? (
          tasks.map((task) => {
            const needsAction = task.status === 'failed' || task.status === 'interrupted'
            return (
              <article key={task.id} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{task.fileName}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {task.stage} · {task.progress}%
                    </p>
                  </div>
                  <TaskStatus status={task.status} />
                </div>

                {(task.status === 'running' || task.status === 'queued') ? (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-amber-300/75 transition-all"
                      style={{ width: `${Math.max(task.progress, 4)}%` }}
                    />
                  </div>
                ) : null}

                {needsAction ? (
                  <div className="mt-3 rounded-[16px] border border-rose-400/15 bg-rose-400/[0.07] px-3 py-3">
                    <p className="text-sm leading-6 text-rose-100">{task.error || '任务没有完成。'}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={retryingTaskId === task.id}
                        onClick={() => onRetry(task.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-rose-300/25 px-3 py-1.5 text-xs text-rose-100 transition hover:border-rose-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${retryingTaskId === task.id ? 'animate-spin' : ''}`} />
                        重试
                      </button>
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
                      >
                        检查设置
                      </button>
                    </div>
                  </div>
                ) : null}

                {task.result?.paperId ? (
                  <button
                    type="button"
                    onClick={() => onOpenPaper(task)}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-amber-300/40 hover:text-amber-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    打开论文
                  </button>
                ) : null}

                {task.logs.length > 0 ? (
                  <details className="group mt-3">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-zinc-500 transition hover:text-zinc-300">
                      <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                      查看日志
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded-[14px] border border-white/8 bg-[#09090b] px-3 py-3 text-xs leading-6 text-zinc-400">
                      {task.logs.slice(-12).join('\n')}
                    </pre>
                  </details>
                ) : null}
              </article>
            )
          })
        ) : (
          <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-5 text-sm text-zinc-500">
            上传 PDF 后，任务会出现在这里。
          </div>
        )}
      </div>
    </aside>
  )
}

function TaskStatus({ status }: { status: ProcessingTask['status'] }) {
  const success = status === 'succeeded'
  const failed = status === 'failed' || status === 'interrupted'
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]',
        success
          ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
          : failed
            ? 'border-rose-300/20 bg-rose-400/10 text-rose-200'
            : 'border-white/10 bg-white/[0.04] text-zinc-300',
      ].join(' ')}
    >
      {success ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : failed ? (
        <AlertCircle className="h-3.5 w-3.5" />
      ) : (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      )}
      {statusLabels[status]}
    </span>
  )
}
