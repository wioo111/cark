import { AlertCircle, RefreshCw, Search, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchCapabilities,
  fetchSettings,
  fetchTasks,
  postRetryTask,
  postUploadPdf,
} from '@/api'
import { PaperListItem } from '@/components/PaperListItem'
import { SettingsPanel } from '@/components/SettingsPanel'
import { TaskCenter } from '@/components/TaskCenter'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { UploadPanel } from '@/components/UploadPanel'
import { ZoteroImportDialog } from '@/components/ZoteroImportDialog'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { AppCapabilities, AppSettings, ProcessingTask } from '@/types'
import { matchesQuery } from '@/utils/paper'

function createFallbackSettings(): AppSettings {
  return {
    mineru: {
      backend: 'local',
      modelVersion: 'pipeline',
      parseMethod: 'auto',
      apiToken: '',
      reuseExistingParse: true,
    },
    translation: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      failRatioLimit: 0.2,
    },
    publish: {
      prepareOnly: true,
      imageMode: 'note',
      folderToken: '',
      appId: '',
      appSecret: '',
    },
    copilot: {
      agents: [
        {
          id: 'agent-default',
          enabled: true,
          name: '共读助手',
          rolePrompt: '你是用户的论文共读伙伴。先准确理解论文，再围绕用户划线句子的上下文给出具体、克制、有判断的评论。',
          apiKey: '',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: '',
        },
      ],
    },
  }
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<AppSettings>(createFallbackSettings)
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null)
  const [tasks, setTasks] = useState<ProcessingTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null)
  const papers = useWorkspaceStore((state) => state.papers)
  const papersLoading = useWorkspaceStore((state) => state.loading)
  const papersError = useWorkspaceStore((state) => state.error)
  const recentPaperIds = useWorkspaceStore((state) => state.recentPaperIds)
  const refreshPapers = useWorkspaceStore((state) => state.refreshPapers)
  const completedTaskIdsRef = useRef<Set<string>>(new Set())
  const uploadBlocked = capabilities === null || !capabilities.ready
  const uploadBlockedReason = capabilities === null
    ? '正在检查这台电脑的可用能力。'
    : capabilities.issues.map((issue) => issue.message).join(' ')

  useEffect(() => {
    document.title = 'cark'
    void refreshPapers()
  }, [refreshPapers])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setTasksLoading(true)
      try {
        const [settingsPayload, taskPayload, capabilityPayload] = await Promise.all([
          fetchSettings(),
          fetchTasks(),
          fetchCapabilities(),
        ])
        if (!cancelled) {
          setSettings(settingsPayload)
          setTasks(taskPayload)
          setCapabilities(capabilityPayload)
          setBootstrapError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setBootstrapError(loadError instanceof Error ? loadError.message : '工作台加载失败')
        }
      } finally {
        if (!cancelled) {
          setTasksLoading(false)
        }
      }
    }

    void bootstrap()
    const intervalId = window.setInterval(() => {
      void fetchTasks()
        .then((payload) => {
          if (!cancelled) {
            setTasks(payload)
          }
        })
        .catch(() => {})
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const nextCompleted = new Set(completedTaskIdsRef.current)
    let shouldRefresh = false
    for (const task of tasks) {
      if (task.status === 'succeeded' && !nextCompleted.has(task.id)) {
        nextCompleted.add(task.id)
        shouldRefresh = true
      }
    }
    completedTaskIdsRef.current = nextCompleted
    if (shouldRefresh) {
      void refreshPapers()
    }
  }, [refreshPapers, tasks])

  const filteredPapers = useMemo(
    () => papers.filter((paper) => matchesQuery(paper, query)),
    [papers, query],
  )

  const recentPapers = useMemo(() => {
    const paperById = new Map(papers.map((paper) => [paper.id, paper]))
    return recentPaperIds
      .map((id) => paperById.get(id))
      .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper))
      .slice(0, 4)
  }, [papers, recentPaperIds])

  async function handleUpload(files: File[]) {
    if (uploadBlocked) {
      setUploadError(uploadBlockedReason || '当前环境还不能上传')
      return
    }
    const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith('.pdf'))
    if (pdfFiles.length === 0) {
      setUploadError('请选择 PDF 文件')
      return
    }
    if (pdfFiles.length !== files.length) {
      setUploadError('已忽略非 PDF 文件，只上传 PDF')
    }
    setUploading(true)
    if (pdfFiles.length === files.length) {
      setUploadError(null)
    }
    try {
      const nextTasks: ProcessingTask[] = []
      const failedFiles: string[] = []

      for (const file of pdfFiles) {
        try {
          nextTasks.push(await postUploadPdf(file))
        } catch {
          failedFiles.push(file.name)
        }
      }

      if (nextTasks.length > 0) {
        setTasks((current) => [
          ...nextTasks,
          ...current.filter((item) => !nextTasks.some((task) => task.id === item.id)),
        ])
      }

      if (failedFiles.length > 0) {
        setUploadError(
          failedFiles.length === 1
            ? `${failedFiles[0]} 上传失败`
            : `${failedFiles.length} 个文件上传失败：${failedFiles.slice(0, 3).join('、')}${failedFiles.length > 3 ? '...' : ''}`,
        )
      } else if (pdfFiles.length !== files.length) {
        setUploadError('已忽略非 PDF 文件，只上传 PDF')
      } else {
        setUploadError(null)
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleRetry(taskId: string) {
    setRetryingTaskId(taskId)
    try {
      const task = await postRetryTask(taskId)
      setTasks((current) => current.map((item) => (item.id === task.id ? task : item)))
    } catch (error) {
      const message = error instanceof Error ? error.message : '重试失败'
      setTasks((current) =>
        current.map((item) => (item.id === taskId ? { ...item, error: message } : item)),
      )
    } finally {
      setRetryingTaskId(null)
    }
  }

  function handleZoteroImported(task: ProcessingTask) {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])
  }

  function openPaper(task: ProcessingTask) {
    if (task.result?.paperId) {
      window.location.assign(`/reader/${encodeURIComponent(task.result.paperId)}`)
    }
  }

  async function handleSettingsSaved(nextSettings: AppSettings) {
    setSettings(nextSettings)
    try {
      setCapabilities(await fetchCapabilities())
    } catch {
      setCapabilities(null)
    }
  }

  return (
    <main className="cark-page min-h-screen">
      <div className="mx-auto min-h-screen max-w-[1600px] px-6 py-6 lg:px-8">
        <header className="flex items-center justify-between gap-5">
          <div>
            <p className="cark-faint text-xs uppercase tracking-[0.28em]">cark</p>
            <h1 className="cark-title mt-1 font-serif text-3xl">论文库</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ThemeSwitch />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
            >
              <Settings2 className="h-4 w-4" />
              设置
            </button>
          </div>
        </header>

        {capabilities && !capabilities.ready ? (
          <section className="mt-6 flex flex-col justify-between gap-3 rounded-[22px] border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
              <div className="text-sm leading-6 text-amber-100">
                {capabilities.issues.map((issue) => (
                  <p key={issue.code}>{issue.message} {issue.action}</p>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 rounded-full border border-amber-300/25 px-3 py-1.5 text-xs text-amber-100 transition hover:border-amber-300/50"
            >
              打开设置
            </button>
          </section>
        ) : null}

        <div className={capabilities && !capabilities.ready ? 'mt-4' : 'mt-6'}>
          <UploadPanel
            uploading={uploading}
            disabled={uploadBlocked}
            disabledReason={uploadBlocked ? uploadBlockedReason : null}
            error={uploadError}
            onUpload={(files) => void handleUpload(files)}
            onOpenZotero={() => setZoteroOpen(true)}
          />
        </div>

        {bootstrapError ? (
          <div className="mt-4 rounded-[20px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {bootstrapError}
          </div>
        ) : null}

        <section className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="cark-panel min-w-0 rounded-[30px] p-5 lg:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="cark-title font-serif text-2xl">所有论文</h2>
                <p className="cark-faint mt-1 text-sm">继续阅读，或找到已经处理过的论文。</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative min-w-[260px]">
                  <Search className="cark-faint pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索论文"
                    className="cark-input w-full rounded-full py-2.5 pl-11 pr-4 text-sm outline-none transition"
                  />
                </div>
                <button
                  type="button"
                  title="刷新论文库"
                  onClick={() => void refreshPapers()}
                  className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
                >
                  <RefreshCw className={`h-4 w-4 ${papersLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {!query && recentPapers.length > 0 ? (
              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="cark-text text-sm font-medium">最近阅读</h3>
                  <span className="cark-faint text-xs">{recentPapers.length}</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {recentPapers.map((paper) => <PaperListItem key={paper.id} paper={paper} recent />)}
                </div>
              </section>
            ) : null}

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="cark-text text-sm font-medium">{query ? '搜索结果' : '全部论文'}</h3>
                <span className="cark-faint text-xs">{filteredPapers.length}</span>
              </div>
              {papersError ? (
                <div className="mb-3 rounded-[20px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                  {papersError}
                </div>
              ) : null}
              <div className="grid gap-3">
                {filteredPapers.map((paper) => <PaperListItem key={paper.id} paper={paper} />)}
                {!papersLoading && filteredPapers.length === 0 ? (
                  <div className="cark-faint rounded-[22px] border border-dashed [border-color:var(--border-strong)] px-5 py-8 text-center text-sm">
                    {query ? '没有匹配的论文。' : '还没有论文。上传第一篇 PDF。'}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <TaskCenter
            tasks={tasks}
            loading={tasksLoading}
            retryingTaskId={retryingTaskId}
            onRetry={(taskId) => void handleRetry(taskId)}
            onOpenPaper={openPaper}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </section>
      </div>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        capabilities={capabilities}
        onClose={() => setSettingsOpen(false)}
        onSaved={(nextSettings) => void handleSettingsSaved(nextSettings)}
      />
      <ZoteroImportDialog
        open={zoteroOpen}
        onClose={() => setZoteroOpen(false)}
        onImported={handleZoteroImported}
      />
    </main>
  )
}
