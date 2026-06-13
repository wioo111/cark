import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileUp,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'

import {
  fetchSettings,
  fetchTasks,
  postOpenRuntime,
  postSettingsConnectionTest,
  postUploadPdf,
  saveSettings,
} from '@/api'
import { PaperListItem } from '@/components/PaperListItem'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { AppSettings, ConnectionTestResult, ProcessingTask } from '@/types'
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
      apiKey: '',
      baseUrl: '',
      model: '',
    },
  }
}

function maskSecret(value: string, visible = 4) {
  const trimmed = value.trim()
  if (!trimmed) {
    return '未配置'
  }
  if (trimmed.length <= visible * 2) {
    return `${trimmed.slice(0, Math.min(2, trimmed.length))}***`
  }
  return `${trimmed.slice(0, visible)}...${trimmed.slice(-visible)}`
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<AppSettings>(createFallbackSettings)
  const [draftSettings, setDraftSettings] = useState<AppSettings>(createFallbackSettings)
  const [tasks, setTasks] = useState<ProcessingTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [connectionTestResults, setConnectionTestResults] = useState<Partial<Record<'mineru' | 'translation', ConnectionTestResult>>>({})
  const [connectionTesting, setConnectionTesting] = useState<{ mineru: boolean; translation: boolean }>({
    mineru: false,
    translation: false,
  })
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const papers = useWorkspaceStore((state) => state.papers)
  const loading = useWorkspaceStore((state) => state.loading)
  const error = useWorkspaceStore((state) => state.error)
  const recentPaperIds = useWorkspaceStore((state) => state.recentPaperIds)
  const refreshPapers = useWorkspaceStore((state) => state.refreshPapers)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const completedTaskIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    document.title = 'cark'
  }, [])

  useEffect(() => {
    void refreshPapers()
  }, [refreshPapers])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setSettingsLoading(true)
      setTasksLoading(true)
      try {
        const [settingsPayload, taskPayload] = await Promise.all([fetchSettings(), fetchTasks()])
        if (cancelled) {
          return
        }
        setSettings(settingsPayload)
        setDraftSettings(settingsPayload)
        setTasks(taskPayload)
        setSettingsError(null)
      } catch (loadError) {
        if (!cancelled) {
          setSettingsError(loadError instanceof Error ? loadError.message : '加载设置失败')
        }
      } finally {
        if (!cancelled) {
          setSettingsLoading(false)
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

  const filteredPapers = useMemo(
    () => papers.filter((paper) => matchesQuery(paper, query)),
    [papers, query],
  )

  const recentPapers = useMemo(() => {
    const indexMap = new Map(papers.map((paper) => [paper.id, paper]))
    return recentPaperIds
      .map((id) => indexMap.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }, [papers, recentPaperIds])

  const taskSummary = useMemo(() => {
    const runningCount = tasks.filter((task) => task.status === 'running' || task.status === 'queued').length
    const failedCount = tasks.filter((task) => task.status === 'failed').length
    return { runningCount, failedCount }
  }, [tasks])

  const settingChips = useMemo(() => {
    return [
      settings.mineru.backend === 'local' ? '本地 MinerU' : '云端 MinerU',
      `解析 ${settings.mineru.parseMethod}`,
      settings.translation.enabled ? '双语已开' : '双语关闭',
      settings.publish.prepareOnly ? '只做本地产物' : '自动导出协作稿',
    ]
  }, [settings])

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
  }, [tasks, refreshPapers])

  function updateDraft<K extends keyof AppSettings>(section: K, value: AppSettings[K]) {
    setDraftSettings((current) => (current ? { ...current, [section]: value } : current))
  }

  async function handleSettingsSave() {
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      const nextSettings = await saveSettings(draftSettings)
      setSettings(nextSettings)
      setDraftSettings(nextSettings)
      setSettingsOpen(false)
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : '保存设置失败')
    } finally {
      setSettingsSaving(false)
    }
  }

  async function handleConnectionTest(target: 'mineru' | 'translation') {
    setConnectionTesting((current) => ({ ...current, [target]: true }))
    setConnectionTestResults((current) => {
      const next = { ...current }
      delete next[target]
      return next
    })

    try {
      const result = await postSettingsConnectionTest(target, draftSettings)
      setConnectionTestResults((current) => ({ ...current, [target]: result }))
    } catch (testError) {
      setConnectionTestResults((current) => ({
        ...current,
        [target]: {
          ok: false,
          message: testError instanceof Error ? testError.message : '连接测试失败',
          detail: null,
        },
      }))
    } finally {
      setConnectionTesting((current) => ({ ...current, [target]: false }))
    }
  }

  async function handleReloadLocalSettings() {
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      const payload = await fetchSettings()
      setSettings(payload)
      setDraftSettings(payload)
      setConnectionTestResults({})
    } catch (loadError) {
      setSettingsError(loadError instanceof Error ? loadError.message : '重新读取本机配置失败')
    } finally {
      setSettingsLoading(false)
    }
  }

  async function handleUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('目前只接 PDF')
      return
    }

    setUploading(true)
    setUploadError(null)
    try {
      const task = await postUploadPdf(file)
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])
    } catch (uploadTaskError) {
      setUploadError(uploadTaskError instanceof Error ? uploadTaskError.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function openPaper(task: ProcessingTask) {
    if (!task.result?.paperId) {
      return
    }
    window.location.assign(`/reader/${encodeURIComponent(task.result.paperId)}`)
  }

  return (
    <main className="min-h-screen bg-[#0b0b0d] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-6 py-6 lg:px-8">
        <section className="grid gap-5 rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" />
              cark
            </div>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-balance font-serif text-4xl leading-tight text-zinc-50 lg:text-5xl">
                本地论文阅读器
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-zinc-300 lg:text-base">
                离线解析，本地存储
              </p>
            </div>
          </div>

          <div className="grid gap-4 rounded-[28px] border border-white/8 bg-black/25 p-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">论文数</p>
                <p className="mt-2 text-2xl text-zinc-50">{papers.length}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">双语</p>
                <p className="mt-2 text-2xl text-zinc-50">
                  {papers.filter((paper) => paper.availableViews.includes('bilingual')).length}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">带图</p>
                <p className="mt-2 text-2xl text-zinc-50">{papers.filter((paper) => paper.hasImages).length}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {settingChips.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-300"
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void refreshPapers()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200 transition hover:border-amber-300/40 hover:text-amber-100"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                刷新列表
              </button>
              <button
                type="button"
                onClick={() => void postOpenRuntime()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200 transition hover:border-white/30 hover:text-zinc-50"
              >
                <FolderOpen className="h-4 w-4" />
                打开产物目录
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200 transition hover:border-white/30 hover:text-zinc-50"
              >
                <Settings2 className="h-4 w-4" />
                全局设置
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 flex flex-1 flex-col gap-6 lg:grid lg:grid-cols-[0.62fr_1fr]">
          <aside className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5">
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragActive(false)
                const file = event.dataTransfer.files?.[0]
                if (file) {
                  void handleUpload(file)
                }
              }}
              className={[
                'rounded-[26px] border border-dashed p-5 transition',
                dragActive
                  ? 'border-amber-300/50 bg-amber-300/10'
                  : 'border-white/10 bg-black/20 hover:border-white/20',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl text-zinc-100">拖拽上传</h2>
                  <p className="mt-1 text-sm leading-7 text-zinc-400">
                    直接丢入 PDF。后台会接现有解析流水线，过程和日志都在这里实时展开。
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-zinc-200">
                  {uploading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/12 px-4 py-2 text-sm text-amber-100 transition hover:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileUp className="h-4 w-4" />
                  选择 PDF
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-white/30 hover:text-zinc-50"
                >
                  <Settings2 className="h-4 w-4" />
                  先调设置
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void handleUpload(file)
                  }
                }}
              />

              {uploadError ? (
                <div className="mt-4 rounded-[20px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {uploadError}
                </div>
              ) : null}
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg text-zinc-100">实时任务</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    运行中 {taskSummary.runningCount} · 失败 {taskSummary.failedCount}
                  </p>
                </div>
                {tasksLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500" /> : null}
              </div>

              <div className="space-y-3">
                {tasks.length > 0 ? (
                  tasks.map((task) => (
                    <article key={task.id} className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">{task.fileName}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {task.stage} · {task.progress}% ·{' '}
                            {new Date(task.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                          </p>
                        </div>
                        <span
                          className={[
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]',
                            task.status === 'succeeded'
                              ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                              : task.status === 'failed'
                                ? 'border border-rose-300/20 bg-rose-400/10 text-rose-200'
                                : 'border border-white/10 bg-white/[0.04] text-zinc-300',
                          ].join(' ')}
                        >
                          {task.status === 'succeeded' ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : task.status === 'failed' ? (
                            <AlertCircle className="h-3.5 w-3.5" />
                          ) : (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          )}
                          {task.status === 'succeeded'
                            ? '完成'
                            : task.status === 'failed'
                              ? '失败'
                              : task.status === 'queued'
                                ? '排队中'
                                : '处理中'}
                        </span>
                      </div>

                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={[
                            'h-full rounded-full transition-all',
                            task.status === 'failed' ? 'bg-rose-400/70' : 'bg-amber-300/75',
                          ].join(' ')}
                          style={{ width: `${Math.max(task.progress, 4)}%` }}
                        />
                      </div>

                      {task.error ? <p className="mt-3 text-sm text-rose-200">{task.error}</p> : null}

                      <pre className="mt-3 max-h-40 overflow-auto rounded-[18px] border border-white/8 bg-[#09090b] px-3 py-3 text-xs leading-6 text-zinc-400">
                        {task.logs.slice(-8).join('\n')}
                      </pre>

                      {task.result?.paperId ? (
                        <button
                          type="button"
                          onClick={() => openPaper(task)}
                          className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-sm text-zinc-200 transition hover:border-amber-300/40 hover:text-amber-100"
                        >
                          <ExternalLink className="h-4 w-4" />
                          打开 {task.result.paperTitle || '论文'}
                        </button>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">
                    还没有任务。把 PDF 丢进来，首页就开始跑。
                  </div>
                )}
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文献标题、ID 或文件名"
                className="w-full rounded-[20px] border border-white/10 bg-black/20 py-3 pl-11 pr-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-300/40"
              />
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg text-zinc-100">最近打开</h2>
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">{recentPapers.length}</span>
              </div>
              <div className="space-y-3">
                {recentPapers.length > 0 ? (
                  recentPapers.map((paper) => <PaperListItem key={paper.id} paper={paper} recent />)
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">
                    还没有最近记录。打开任意一篇后会出现在这里。
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-serif text-2xl text-zinc-100">论文工作台</h2>
                <p className="mt-1 text-sm text-zinc-400">所有经过解析的文献资源均在此列出。</p>
              </div>
              <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">{filteredPapers.length} items</span>
            </div>

            {error ? (
              <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <div className="grid gap-4">
              {filteredPapers.map((paper) => (
                <PaperListItem key={paper.id} paper={paper} />
              ))}
              {!loading && filteredPapers.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-6 text-sm text-zinc-500">
                  当前没有可读文献。直接在左侧上传 PDF，就会开始生成本地产物。
                </div>
              ) : null}
            </div>
          </section>
        </section>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-[760px] flex-col border-l border-white/10 bg-[#0d0d10]">
            <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
              <div>
                <h2 className="font-serif text-2xl text-zinc-100">全局设置</h2>
                <p className="mt-1 text-sm text-zinc-400">把解析、翻译、发布和后续共读模型都收进 GUI。</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-white/10 p-2 text-zinc-300 transition hover:border-white/30 hover:text-zinc-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="grid gap-6">
                <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-xl text-zinc-100">当前接入状态</h3>
                      <p className="mt-1 text-sm text-zinc-500">优先读取你机器上的现有环境变量，并写入本地设置文件。</p>
                    </div>
                    <button
                      type="button"
                      disabled={settingsLoading}
                      onClick={() => void handleReloadLocalSettings()}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/30 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {settingsLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      重新读取本机配置
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      {
                        label: 'MinerU 云 Token',
                        configured: Boolean(draftSettings.mineru.apiToken.trim()),
                        value: maskSecret(draftSettings.mineru.apiToken),
                      },
                      {
                        label: '翻译 API',
                        configured: Boolean(draftSettings.translation.apiKey.trim()),
                        value: maskSecret(draftSettings.translation.apiKey),
                      },
                      {
                        label: '协作平台导出',
                        configured:
                          Boolean(draftSettings.publish.folderToken.trim()) &&
                          Boolean(draftSettings.publish.appId.trim()) &&
                          Boolean(draftSettings.publish.appSecret.trim()),
                        value: draftSettings.publish.prepareOnly ? '当前仅本地产物' : '已启用自动导出',
                      },
                      {
                        label: '共读模型',
                        configured: Boolean(draftSettings.copilot.apiKey.trim()),
                        value: draftSettings.copilot.model.trim() || '未配置',
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-zinc-200">{item.label}</p>
                          <span
                            className={[
                              'rounded-full px-2.5 py-1 text-[11px]',
                              item.configured
                                ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                                : 'border border-white/10 bg-white/[0.04] text-zinc-400',
                            ].join(' ')}
                          >
                            {item.configured ? '已接入' : '未接入'}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-xs text-zinc-500">设置会写入 `config/gui_settings.json`，下次打开直接复用。</p>
                </section>

                <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-serif text-xl text-zinc-100">MinerU</h3>
                    <button
                      type="button"
                      disabled={connectionTesting.mineru}
                      onClick={() => void handleConnectionTest('mineru')}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/30 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connectionTesting.mineru ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      测试云连接
                    </button>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-zinc-500">
                    这几项不是给开发者看的黑话，而是在决定这篇 PDF 在哪里解析、按什么识别策略解析、以及云端具体用哪套能力。
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-zinc-300">
                      解析后端
                      <select
                        value={draftSettings.mineru.backend}
                        onChange={(event) =>
                          updateDraft('mineru', { ...draftSettings.mineru, backend: event.target.value as AppSettings['mineru']['backend'] })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
                      >
                        <option value="local">local | 本机解析</option>
                        <option value="cloud">cloud | 云端解析</option>
                      </select>
                      <span className="text-xs leading-6 text-zinc-500">
                        `local` 表示直接用你这台机器跑 MinerU；`cloud` 表示把 PDF 发到 MinerU 云端去解析。想本地闭环就选 `local`，想省本地依赖就选 `cloud`。
                      </span>
                    </label>

                    <label className="grid gap-2 text-sm text-zinc-300">
                      解析模式
                      <select
                        value={draftSettings.mineru.parseMethod}
                        onChange={(event) =>
                          updateDraft('mineru', {
                            ...draftSettings.mineru,
                            parseMethod: event.target.value as AppSettings['mineru']['parseMethod'],
                          })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
                      >
                        <option value="auto">auto | 自动判断</option>
                        <option value="txt">txt | 文字型 PDF</option>
                        <option value="ocr">ocr | 扫描型 PDF</option>
                      </select>
                      <span className="text-xs leading-6 text-zinc-500">
                        `auto` 让系统自己判断；`txt` 适合原生电子版论文；`ocr` 适合扫描件、截图版、影印版。大多数时候先用 `auto`。
                      </span>
                    </label>

                    <label className="grid gap-2 text-sm text-zinc-300">
                      云模型版本
                      <select
                        value={draftSettings.mineru.modelVersion}
                        onChange={(event) =>
                          updateDraft('mineru', {
                            ...draftSettings.mineru,
                            modelVersion: event.target.value as AppSettings['mineru']['modelVersion'],
                          })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
                      >
                        <option value="pipeline">pipeline | 标准方案</option>
                        <option value="vlm">vlm | 增强视觉方案</option>
                      </select>
                      <span className="text-xs leading-6 text-zinc-500">
                        这一项只在 `cloud` 时生效。`pipeline` 更稳、更接近默认主流程；`vlm` 更偏复杂视觉理解，适合复杂版面识别不理想时再试。
                      </span>
                    </label>

                    <label className="grid gap-2 text-sm text-zinc-300">
                      MinerU API Token
                      <input
                        type="password"
                        value={draftSettings.mineru.apiToken}
                        onChange={(event) =>
                          updateDraft('mineru', { ...draftSettings.mineru, apiToken: event.target.value })
                        }
                        placeholder="云端解析时使用"
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                      <span className="text-xs leading-6 text-zinc-500">
                        这是 MinerU 云端鉴权凭据。只有当“解析后端”选成 `cloud` 时才会真正使用。
                      </span>
                      <span className="text-xs text-zinc-500">当前值：{maskSecret(draftSettings.mineru.apiToken)}</span>
                    </label>
                  </div>

                  <label className="mt-4 flex items-center gap-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={draftSettings.mineru.reuseExistingParse}
                      onChange={(event) =>
                        updateDraft('mineru', {
                          ...draftSettings.mineru,
                          reuseExistingParse: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-white/20 bg-black/20"
                    />
                    优先复用已有解析结果
                  </label>
                  <p className="mt-2 text-xs leading-6 text-zinc-500">
                    打开后，如果这篇论文之前已经解析过，就优先复用旧产物，避免重复跑一遍。适合普通使用；只有你明确要强制重跑时再关掉。
                  </p>

                  {connectionTestResults.mineru ? (
                    <div
                      className={[
                        'mt-4 rounded-[20px] px-4 py-3 text-sm',
                        connectionTestResults.mineru.ok
                          ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                          : 'border border-rose-400/20 bg-rose-400/10 text-rose-100',
                      ].join(' ')}
                    >
                      <p>{connectionTestResults.mineru.message}</p>
                      {connectionTestResults.mineru.detail ? (
                        <p className="mt-1 text-xs opacity-80">{connectionTestResults.mineru.detail}</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-serif text-xl text-zinc-100">双语翻译</h3>
                    <button
                      type="button"
                      disabled={connectionTesting.translation}
                      onClick={() => void handleConnectionTest('translation')}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/30 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connectionTesting.translation ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      测试翻译模型
                    </button>
                  </div>
                  <label className="mt-4 flex items-center gap-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={draftSettings.translation.enabled}
                      onChange={(event) =>
                        updateDraft('translation', {
                          ...draftSettings.translation,
                          enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-white/20 bg-black/20"
                    />
                    上传后自动生成双语稿
                  </label>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-zinc-300 md:col-span-2">
                      翻译 API Key
                      <input
                        type="password"
                        value={draftSettings.translation.apiKey}
                        onChange={(event) =>
                          updateDraft('translation', { ...draftSettings.translation, apiKey: event.target.value })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                      <span className="text-xs text-zinc-500">当前值：{maskSecret(draftSettings.translation.apiKey)}</span>
                    </label>

                    <label className="grid gap-2 text-sm text-zinc-300">
                      Base URL
                      <input
                        value={draftSettings.translation.baseUrl}
                        onChange={(event) =>
                          updateDraft('translation', { ...draftSettings.translation, baseUrl: event.target.value })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                      <span className="text-xs text-zinc-500">当前链路：{draftSettings.translation.baseUrl || '未配置'}</span>
                    </label>

                    <label className="grid gap-2 text-sm text-zinc-300">
                      失败阈值
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={draftSettings.translation.failRatioLimit}
                        onChange={(event) =>
                          updateDraft('translation', {
                            ...draftSettings.translation,
                            failRatioLimit: Number(event.target.value || 0),
                          })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                    </label>
                  </div>

                  {connectionTestResults.translation ? (
                    <div
                      className={[
                        'mt-4 rounded-[20px] px-4 py-3 text-sm',
                        connectionTestResults.translation.ok
                          ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                          : 'border border-rose-400/20 bg-rose-400/10 text-rose-100',
                      ].join(' ')}
                    >
                      <p>{connectionTestResults.translation.message}</p>
                      {connectionTestResults.translation.detail ? (
                        <p className="mt-1 text-xs opacity-80">{connectionTestResults.translation.detail}</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <h3 className="font-serif text-xl text-zinc-100">协作平台导出</h3>
                  <label className="mt-4 flex items-center gap-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={draftSettings.publish.prepareOnly}
                      onChange={(event) =>
                        updateDraft('publish', { ...draftSettings.publish, prepareOnly: event.target.checked })
                      }
                      className="h-4 w-4 rounded border-white/20 bg-black/20"
                    />
                    只做本地产物，不自动导出到协作平台
                  </label>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-zinc-300">
                      图片策略
                      <select
                        value={draftSettings.publish.imageMode}
                        onChange={(event) =>
                          updateDraft('publish', {
                            ...draftSettings.publish,
                            imageMode: event.target.value as AppSettings['publish']['imageMode'],
                          })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
                      >
                        <option value="note">note</option>
                        <option value="keep">keep</option>
                        <option value="strip">strip</option>
                      </select>
                    </label>
                  </div>

                  {!draftSettings.publish.prepareOnly ? (
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="grid gap-2 text-sm text-zinc-300">
                        Folder Token
                        <input
                          value={draftSettings.publish.folderToken}
                          onChange={(event) =>
                            updateDraft('publish', { ...draftSettings.publish, folderToken: event.target.value })
                          }
                          className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                        />
                        <span className="text-xs text-zinc-500">当前值：{maskSecret(draftSettings.publish.folderToken)}</span>
                      </label>
                      <label className="grid gap-2 text-sm text-zinc-300">
                        App ID
                        <input
                          value={draftSettings.publish.appId}
                          onChange={(event) =>
                            updateDraft('publish', { ...draftSettings.publish, appId: event.target.value })
                          }
                          className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                        />
                        <span className="text-xs text-zinc-500">当前值：{maskSecret(draftSettings.publish.appId)}</span>
                      </label>
                      <label className="grid gap-2 text-sm text-zinc-300 md:col-span-2">
                        App Secret
                        <input
                          type="password"
                          value={draftSettings.publish.appSecret}
                          onChange={(event) =>
                            updateDraft('publish', { ...draftSettings.publish, appSecret: event.target.value })
                          }
                          className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                        />
                        <span className="text-xs text-zinc-500">当前值：{maskSecret(draftSettings.publish.appSecret)}</span>
                      </label>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <h3 className="font-serif text-xl text-zinc-100">共读模型</h3>
                  <p className="mt-1 text-sm text-zinc-500">先把密钥和模型位存起来，后面接智能体共读直接用。</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-zinc-300">
                      API Key
                      <input
                        type="password"
                        value={draftSettings.copilot.apiKey}
                        onChange={(event) =>
                          updateDraft('copilot', { ...draftSettings.copilot, apiKey: event.target.value })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                      <span className="text-xs text-zinc-500">当前值：{maskSecret(draftSettings.copilot.apiKey)}</span>
                    </label>
                    <label className="grid gap-2 text-sm text-zinc-300">
                      Base URL
                      <input
                        value={draftSettings.copilot.baseUrl}
                        onChange={(event) =>
                          updateDraft('copilot', { ...draftSettings.copilot, baseUrl: event.target.value })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-zinc-300 md:col-span-2">
                      Model
                      <input
                        value={draftSettings.copilot.model}
                        onChange={(event) =>
                          updateDraft('copilot', { ...draftSettings.copilot, model: event.target.value })
                        }
                        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/40"
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>

            <div className="border-t border-white/8 px-6 py-4">
              {settingsError ? (
                <div className="mb-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {settingsError}
                </div>
              ) : null}
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDraftSettings(settings)
                    setSettingsOpen(false)
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-white/30 hover:text-zinc-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={settingsSaving || settingsLoading}
                  onClick={() => void handleSettingsSave()}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/12 px-4 py-2 text-sm text-amber-100 transition hover:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {settingsSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
