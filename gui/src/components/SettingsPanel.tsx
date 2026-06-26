import { Bot, CheckCircle2, ChevronDown, Copy, ExternalLink, LoaderCircle, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { fetchSettings, postSettingsConnectionTest, saveSettings } from '@/api'
import type { AppCapabilities, AppSettings, ConnectionTestResult, CopilotAgentConfig } from '@/types'

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
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult | undefined>>({})

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

  function updateAgent(agentId: string, patch: Partial<CopilotAgentConfig>) {
    updateDraft('copilot', {
      agents: draft.copilot.agents.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)),
    })
  }

  function addAgent() {
    updateDraft('copilot', {
      agents: [
        ...draft.copilot.agents,
        createCopilotAgent(draft.copilot.agents.length + 1),
      ],
    })
  }

  function copyAgent(agent: CopilotAgentConfig, index: number) {
    updateDraft('copilot', {
      agents: [
        ...draft.copilot.agents.slice(0, index + 1),
        {
          ...agent,
          id: `agent-${Date.now()}-${index + 1}-copy`,
          enabled: false,
          name: `${agent.name.trim() || `共读助手 ${index + 1}`} 副本`,
        },
        ...draft.copilot.agents.slice(index + 1),
      ],
    })
  }

  function removeAgent(agentId: string) {
    const nextAgents = draft.copilot.agents.filter((agent) => agent.id !== agentId)
    updateDraft('copilot', {
      agents: nextAgents.length > 0 ? nextAgents : [createCopilotAgent(1)],
    })
  }

  async function handleSave() {
    const invalidAgent = draft.copilot.agents.find((agent) => agent.enabled && getAgentMissingFields(agent).length > 0)
    if (invalidAgent) {
      setError(`“${invalidAgent.name.trim() || '未命名智能体'}”已启用，但缺少：${getAgentMissingFields(invalidAgent).join('、')}。补齐后再保存，或先关闭启用。`)
      return
    }
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

  async function handleAgentTest(agent: CopilotAgentConfig) {
    const testKey = agentTestKey(agent.id)
    const missingFields = getAgentMissingFields(agent)
    if (missingFields.length > 0) {
      setTestResults((current) => ({
        ...current,
        [testKey]: {
          ok: false,
          message: `先补齐：${missingFields.join('、')}`,
          detail: null,
        },
      }))
      return
    }

    setTesting(testKey)
    setTestResults((current) => ({ ...current, [testKey]: undefined }))
    try {
      const result = await postSettingsConnectionTest('copilot_agent', draft, { agentId: agent.id })
      setTestResults((current) => ({ ...current, [testKey]: result }))
    } catch (testError) {
      setTestResults((current) => ({
        ...current,
        [testKey]: {
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
    <div className="cark-overlay fixed inset-0 z-50 flex justify-end backdrop-blur-sm">
      <button type="button" aria-label="关闭设置" className="flex-1" onClick={onClose} />
      <div className="cark-panel flex h-full w-full max-w-[720px] flex-col border-l bg-[var(--surface-elevated)]">
        <div className="flex items-center justify-between border-b px-6 py-5 [border-color:var(--border-soft)]">
          <div>
            <h2 className="cark-title font-serif text-2xl">设置</h2>
            <p className="cark-faint mt-1 text-sm">普通使用只需要决定解析位置和是否翻译。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cark-button-secondary rounded-full p-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <section className="cark-card rounded-[26px] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200">常用设置</p>
                <h3 className="cark-title mt-2 font-serif text-xl">MinerU 配置</h3>
                <p className="cark-faint mt-2 text-sm leading-6">先决定走本地还是云端，再按指引补齐必要配置。</p>
              </div>
              <button
                type="button"
                disabled={reloading}
                onClick={() => void handleReload()}
                className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs disabled:opacity-60"
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

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-[rgba(var(--accent-rgb),0.9)]">官网入口</p>
                  <a
                    href="https://mineru.net/doc/docs/"
                    target="_blank"
                    rel="noreferrer"
                    className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                  >
                    打开 MinerU 文档
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="cark-text mt-3 text-sm leading-7">
                  如果你还没装过 MinerU，先看官方文档确认安装方式和运行环境，再回到这里填写 Token 或切回本地解析。
                </p>
              </div>
              <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-[rgba(var(--accent-rgb),0.9)]">配置指引</p>
                <div className="cark-text mt-3 space-y-2 text-sm leading-7">
                  <p>1. 选“这台电脑”：适合本地直接跑 MinerU，先确认本机解析环境可用。</p>
                  <p>2. 选“云端服务”：去官网申请 Token，填进“云端解析 Token”后测试连接。</p>
                  <p>3. 需要中文译文：打开下方开关，再补翻译 API Key。</p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5">
              <label className="cark-text grid gap-2 text-sm">
                解析位置
                <select
                  value={draft.mineru.backend}
                  onChange={(event) =>
                    updateDraft('mineru', {
                      ...draft.mineru,
                      backend: event.target.value as AppSettings['mineru']['backend'],
                    })
                  }
                  className="cark-input rounded-[18px] px-3 py-3 outline-none"
                >
                  <option value="local">这台电脑</option>
                  <option value="cloud">云端服务</option>
                </select>
                <span className="cark-faint text-xs leading-6">
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

              <label className="cark-text flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.translation.enabled}
                  onChange={(event) =>
                    updateDraft('translation', {
                      ...draft.translation,
                      enabled: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-[var(--surface-input)]"
                />
                上传后生成译文版本
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

          <details className="cark-card group mt-5 rounded-[26px]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="cark-faint text-xs uppercase tracking-[0.2em]">高级设置</p>
                <p className="cark-text mt-1 text-sm">解析策略和翻译参数</p>
              </div>
              <ChevronDown className="cark-faint h-4 w-4 transition group-open:rotate-180" />
            </summary>
            <div className="grid gap-5 border-t px-5 py-5 [border-color:var(--border-soft)]">
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

              <label className="cark-text flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.mineru.reuseExistingParse}
                  onChange={(event) =>
                    updateDraft('mineru', {
                      ...draft.mineru,
                      reuseExistingParse: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-[var(--surface-input)]"
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
            </div>
          </details>

          <section className="cark-card mt-5 rounded-[26px] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[rgba(var(--accent-rgb),0.9)]">共读智能体</p>
                <h3 className="cark-title mt-2 font-serif text-xl">多智能体配置</h3>
                <p className="cark-faint mt-2 max-w-2xl text-sm leading-6">
                  这里不写死成单一助手。每个智能体都可以拥有独立的模型、API 和身份注入，后面在评论区按角色召唤。
                </p>
              </div>
              <button
                type="button"
                onClick={addAgent}
                className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm"
              >
                <Plus className="h-4 w-4" />
                添加智能体
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {draft.copilot.agents.map((agent, index) => (
                <section key={agent.id} className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[rgba(var(--accent-rgb),0.08)] text-[rgba(var(--accent-rgb),0.92)]">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="cark-faint text-xs uppercase tracking-[0.18em]">智能体 {index + 1}</p>
                        <p className="cark-text mt-1 text-sm">{agent.description?.trim() || '用于评论区召唤，围绕划线句子给出角色化共读意见。'}</p>
                        <p className={`mt-2 text-xs ${agent.enabled && getAgentMissingFields(agent).length === 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                          {agent.enabled
                            ? getAgentMissingFields(agent).length === 0
                              ? '已启用，可用于共读'
                              : `已启用但缺少：${getAgentMissingFields(agent).join('、')}`
                            : '已禁用，配置会保留但不会出现在共读入口'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="cark-text inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={agent.enabled}
                          onChange={(event) => updateAgent(agent.id, { enabled: event.target.checked })}
                          className="h-4 w-4 rounded border-white/20 bg-[var(--surface-input)]"
                        />
                        启用
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleAgentTest(agent)}
                        disabled={testing === agentTestKey(agent.id)}
                        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs disabled:opacity-60"
                      >
                        {testing === agentTestKey(agent.id) ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        测试智能体
                      </button>
                      <button
                        type="button"
                        onClick={() => copyAgent(agent, index)}
                        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAgent(agent.id)}
                        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <TextField
                      label="命名"
                      value={agent.name}
                      onChange={(value) => updateAgent(agent.id, { name: value })}
                    />
                    <TextField
                      label="模型"
                      value={agent.model}
                      placeholder="例如 openai/gpt-4.1-mini"
                      onChange={(value) => updateAgent(agent.id, { model: value })}
                    />
                    <TextField
                      label="Base URL"
                      value={agent.baseUrl}
                      onChange={(value) => updateAgent(agent.id, { baseUrl: value })}
                    />
                    <TextField
                      label="API Key"
                      type="password"
                      value={agent.apiKey}
                      onChange={(value) => updateAgent(agent.id, { apiKey: value })}
                    />
                  </div>

                  <TextField
                    label="用途说明"
                    value={agent.description ?? ''}
                    placeholder="例如：重点检查方法、限制和可复用判断。"
                    onChange={(value) => updateAgent(agent.id, { description: value })}
                  />

                  <label className="cark-text mt-4 grid gap-2 text-sm">
                    身份注入
                    <textarea
                      value={agent.rolePrompt}
                      onChange={(event) => updateAgent(agent.id, { rolePrompt: event.target.value })}
                      placeholder="例如：你是一个严苛的审稿人，重点指出逻辑漏洞、证据不足和方法风险。"
                      className="cark-input min-h-[132px] resize-y rounded-[18px] px-3 py-3 text-sm leading-7 outline-none"
                    />
                  </label>

                  {testResults[agentTestKey(agent.id)] ? (
                    <p className={`mt-3 text-xs ${testResults[agentTestKey(agent.id)]?.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {testResults[agentTestKey(agent.id)]?.message}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t px-6 py-4 [border-color:var(--border-soft)]">
          {error ? (
            <div className="mb-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="cark-button-secondary rounded-full px-4 py-2 text-sm"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="cark-button-accent inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm disabled:opacity-60"
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

function createCopilotAgent(index: number): CopilotAgentConfig {
  return {
    id: `agent-${Date.now()}-${index}`,
    enabled: true,
    name: `共读助手 ${index}`,
    description: '围绕划线句子解释、质疑，并沉淀可复用研究判断。',
    rolePrompt: '你是用户的论文共读伙伴。先完整理解论文，再围绕用户划线句子的上下文给出具体、克制、有判断的评论。',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
  }
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
      <label className="cark-text grid gap-2 text-sm">
        {label}
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="cark-input rounded-[18px] px-3 py-3 outline-none"
        />
      </label>
      <button
        type="button"
        disabled={testing || !value.trim()}
        onClick={onTest}
        className="cark-faint mt-2 inline-flex items-center gap-2 text-xs transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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
    <label className="cark-text grid gap-2 text-sm">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cark-input rounded-[18px] px-3 py-3 outline-none"
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
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label className="cark-text grid gap-2 text-sm">
      {label}
      <input
        type={type}
        value={value}
        min={type === 'number' ? 0 : undefined}
        max={type === 'number' ? 1 : undefined}
        step={type === 'number' ? 0.05 : undefined}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="cark-input rounded-[18px] px-3 py-3 outline-none"
      />
    </label>
  )
}

function agentTestKey(agentId: string) {
  return `agent:${agentId}`
}

function getAgentMissingFields(agent: CopilotAgentConfig) {
  const missing: string[] = []
  if (!agent.name.trim()) {
    missing.push('名称')
  }
  if (!agent.rolePrompt.trim()) {
    missing.push('身份注入')
  }
  if (!agent.apiKey.trim()) {
    missing.push('API Key')
  }
  if (!agent.baseUrl.trim()) {
    missing.push('Base URL')
  }
  if (!agent.model.trim()) {
    missing.push('模型')
  }
  return missing
}
