import { CheckCircle2, ChevronDown, LoaderCircle, RefreshCw, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { fetchSettings, postSettingsConnectionTest, saveSettings } from '@/api'
import type { AppCapabilities, AppSettings, ConnectionTestResult } from '@/types'

interface SettingsPanelProps {
  open: boolean
  settings: AppSettings
  capabilities: AppCapabilities | null
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

export function SettingsPanel({ open, settings, capabilities, onClose, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<'mineru' | 'translation' | null>(null)
  const [testResults, setTestResults] = useState<Partial<Record<'mineru' | 'translation', ConnectionTestResult>>>({})

  useEffect(() => {
    if (open) {
      setDraft(settings)
      setError(null)
      setTestResults({})
    }
  }, [open, settings])

  if (!open) {
    return null
  }

  function updateDraft<K extends keyof AppSettings>(section: K, value: AppSettings[K]) {
    setDraft((current) => ({ ...current, [section]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const saved = await saveSettings(draft)
      onSaved(saved)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存设置失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleReload() {
    setReloading(true)
    setError(null)
    try {
      setDraft(await fetchSettings())
      setTestResults({})
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取设置失败')
    } finally {
      setReloading(false)
    }
  }

  async function handleTest(target: 'mineru' | 'translation') {
    setTesting(target)
    setTestResults((current) => ({ ...current, [target]: undefined }))
    try {
      const result = await postSettingsConnectionTest(target, draft)
      setTestResults((current) => ({ ...current, [target]: result }))
    } catch (testError) {
      setTestResults((current) => ({
        ...current,
        [target]: {
          ok: false,
          message: testError instanceof Error ? testError.message : '连接测试失败',
          detail: null,
        },
      }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm">
      <button type="button" aria-label="关闭设置" className="flex-1" onClick={onClose} />
      <div className="flex h-full w-full max-w-[720px] flex-col border-l border-white/10 bg-[#0d0d10]">
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
          <div>
            <h2 className="font-serif text-2xl text-zinc-100">设置</h2>
            <p className="mt-1 text-sm text-zinc-500">普通使用只需要决定解析位置和是否翻译。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 p-2 text-zinc-300 transition hover:border-white/30 hover:text-zinc-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <section className="rounded-[26px] border border-white/8 bg-white/[0.03] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200">常用设置</p>
                <h3 className="mt-2 font-serif text-xl text-zinc-100">上传后怎么处理</h3>
              </div>
              <button
                type="button"
                disabled={reloading}
                onClick={() => void handleReload()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-400 transition hover:border-white/25 hover:text-zinc-100 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
                重新读取
              </button>
            </div>

            {capabilities && !capabilities.ready ? (
              <div className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">
                {capabilities.issues.map((issue) => (
                  <p key={issue.code}>{issue.message} {issue.action}</p>
                ))}
              </div>
            ) : null}

            <div className="mt-5 grid gap-5">
              <label className="grid gap-2 text-sm text-zinc-300">
                解析位置
                <select
                  value={draft.mineru.backend}
                  onChange={(event) =>
                    updateDraft('mineru', {
                      ...draft.mineru,
                      backend: event.target.value as AppSettings['mineru']['backend'],
                    })
                  }
                  className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
                >
                  <option value="local">这台电脑</option>
                  <option value="cloud">云端服务</option>
                </select>
                <span className="text-xs leading-6 text-zinc-500">
                  本机更私密；云端无需本机解析环境。
                </span>
              </label>

              {draft.mineru.backend === 'cloud' ? (
                <CredentialField
                  label="云端解析 Token"
                  value={draft.mineru.apiToken}
                  onChange={(value) => updateDraft('mineru', { ...draft.mineru, apiToken: value })}
                  testing={testing === 'mineru'}
                  result={testResults.mineru}
                  onTest={() => void handleTest('mineru')}
                />
              ) : null}

              <label className="flex items-center gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={draft.translation.enabled}
                  onChange={(event) =>
                    updateDraft('translation', {
                      ...draft.translation,
                      enabled: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                上传后生成中英双语稿
              </label>

              {draft.translation.enabled ? (
                <CredentialField
                  label="翻译 API Key"
                  value={draft.translation.apiKey}
                  onChange={(value) => updateDraft('translation', { ...draft.translation, apiKey: value })}
                  testing={testing === 'translation'}
                  result={testResults.translation}
                  onTest={() => void handleTest('translation')}
                />
              ) : null}
            </div>
          </section>

          <details className="group mt-5 rounded-[26px] border border-white/8 bg-white/[0.02]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">高级设置</p>
                <p className="mt-1 text-sm text-zinc-300">解析策略、失败阈值和发布配置</p>
              </div>
              <ChevronDown className="h-4 w-4 text-zinc-500 transition group-open:rotate-180" />
            </summary>
            <div className="grid gap-5 border-t border-white/8 px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label="PDF 识别方式"
                  value={draft.mineru.parseMethod}
                  onChange={(value) =>
                    updateDraft('mineru', {
                      ...draft.mineru,
                      parseMethod: value as AppSettings['mineru']['parseMethod'],
                    })
                  }
                  options={[
                    ['auto', '自动判断'],
                    ['txt', '文字型 PDF'],
                    ['ocr', '扫描型 PDF'],
                  ]}
                />
                {draft.mineru.backend === 'cloud' ? (
                  <SelectField
                    label="云端模型版本"
                    value={draft.mineru.modelVersion}
                    onChange={(value) =>
                      updateDraft('mineru', {
                        ...draft.mineru,
                        modelVersion: value as AppSettings['mineru']['modelVersion'],
                      })
                    }
                    options={[
                      ['pipeline', '标准方案'],
                      ['vlm', '复杂版面增强'],
                    ]}
                  />
                ) : null}
              </div>

              <label className="flex items-center gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={draft.mineru.reuseExistingParse}
                  onChange={(event) =>
                    updateDraft('mineru', {
                      ...draft.mineru,
                      reuseExistingParse: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                优先复用已有解析结果
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label="翻译 Base URL"
                  value={draft.translation.baseUrl}
                  onChange={(value) => updateDraft('translation', { ...draft.translation, baseUrl: value })}
                />
                <TextField
                  label="翻译模型"
                  value={draft.translation.model}
                  onChange={(value) => updateDraft('translation', { ...draft.translation, model: value })}
                />
                <TextField
                  label="翻译失败阈值"
                  type="number"
                  value={String(draft.translation.failRatioLimit)}
                  onChange={(value) =>
                    updateDraft('translation', {
                      ...draft.translation,
                      failRatioLimit: Number(value || 0),
                    })
                  }
                />
              </div>

              <label className="flex items-center gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={draft.publish.prepareOnly}
                  onChange={(event) =>
                    updateDraft('publish', {
                      ...draft.publish,
                      prepareOnly: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                只保留本地产物
              </label>

              <SelectField
                label="图片处理"
                value={draft.publish.imageMode}
                onChange={(value) =>
                  updateDraft('publish', {
                    ...draft.publish,
                    imageMode: value as AppSettings['publish']['imageMode'],
                  })
                }
                options={[
                  ['note', '转为说明'],
                  ['keep', '保留'],
                  ['strip', '移除'],
                ]}
              />

              {!draft.publish.prepareOnly ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Folder Token"
                    value={draft.publish.folderToken}
                    onChange={(value) => updateDraft('publish', { ...draft.publish, folderToken: value })}
                  />
                  <TextField
                    label="App ID"
                    value={draft.publish.appId}
                    onChange={(value) => updateDraft('publish', { ...draft.publish, appId: value })}
                  />
                  <TextField
                    label="App Secret"
                    type="password"
                    value={draft.publish.appSecret}
                    onChange={(value) => updateDraft('publish', { ...draft.publish, appSecret: value })}
                  />
                </div>
              ) : null}
            </div>
          </details>
        </div>

        <div className="border-t border-white/8 px-6 py-4">
          {error ? (
            <div className="mb-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/12 px-4 py-2 text-sm text-amber-100 transition hover:border-amber-300/50 disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CredentialField({
  label,
  value,
  onChange,
  testing,
  result,
  onTest,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  testing: boolean
  result?: ConnectionTestResult
  onTest: () => void
}) {
  return (
    <div>
      <label className="grid gap-2 text-sm text-zinc-300">
        {label}
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
        />
      </label>
      <button
        type="button"
        disabled={testing || !value.trim()}
        onClick={onTest}
        className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-400 transition hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {testing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        测试连接
      </button>
      {result ? (
        <p className={`mt-2 text-xs ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{result.message}</p>
      ) : null}
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-2 text-sm text-zinc-300">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="grid gap-2 text-sm text-zinc-300">
      {label}
      <input
        type={type}
        value={value}
        min={type === 'number' ? 0 : undefined}
        max={type === 'number' ? 1 : undefined}
        step={type === 'number' ? 0.05 : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[18px] border border-white/10 bg-black/25 px-3 py-3 text-zinc-100 outline-none focus:border-amber-300/40"
      />
    </label>
  )
}
