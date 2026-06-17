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
    <aside className="cark-panel min-w-0 rounded-[30px] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="cark-title font-serif text-xl">任务</h2>
          <p className="cark-faint mt-1 text-xs">上传后的进度和历史会保留在这里。</p>
        </div>
        {loading ? <LoaderCircle className="cark-faint h-4 w-4 animate-spin" /> : null}
      </div>

      <div className="mt-4 space-y-3">
        {tasks.length > 0 ? (
          tasks.map((task) => {
            const needsAction = task.status === 'failed' || task.status === 'interrupted'
            return (
              <article key={task.id} className="cark-card rounded-[22px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="cark-title truncate text-sm font-medium">{task.fileName}</p>
                    <p className="cark-faint mt-1 text-xs">
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
                    className="cark-button-secondary mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    打开论文
                  </button>
                ) : null}

                {task.logs.length > 0 ? (
                  <details className="group mt-3">
                    <summary className="cark-faint flex cursor-pointer list-none items-center gap-2 text-xs transition hover:text-[var(--text-secondary)]">
                      <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                      查看日志
                    </summary>
                    <pre className="cark-card cark-muted mt-2 max-h-40 overflow-auto rounded-[14px] px-3 py-3 text-xs leading-6">
                      {task.logs.slice(-12).join('\n')}
                    </pre>
                  </details>
                ) : null}
              </article>
            )
          })
        ) : (
          <div className="cark-faint rounded-[20px] border border-dashed [border-color:var(--border-strong)] px-4 py-5 text-sm">
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
            : 'cark-card cark-text',
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
