import type {
  AppSettings,
  AppCapabilities,
  AgentMemoryPayload,
  ConnectionTestResult,
  CopilotRun,
  CopilotAgentConfig,
  CreateAgentMemoryInput,
  CreateCopilotRunInput,
  CreateAnnotationCommentInput,
  InvokeAnnotationAgentInput,
  CreatePaperMemoryItemInput,
  MemoryCandidateItem,
  MemoryCandidatePayload,
  CreatePaperAnnotationInput,
  CreatePaperNoteInput,
  PaperAnnotation,
  PaperDetail,
  PaperMemory,
  PaperMemoryMarkdownExport,
  PaperSummary,
  ProcessingTask,
  ReadingState,
  SearchResult,
  UpdateAgentMemoryInput,
  UpdateAnnotationCommentInput,
  UpdatePaperLibraryInput,
  UpdatePaperMemoryItemInput,
  UpdatePaperAnnotationInput,
  ZoteroPaper,
  ZoteroStatus,
} from '@/types'

function createDefaultCopilotAgent(overrides?: Partial<CopilotAgentConfig>): CopilotAgentConfig {
  return {
    id: 'agent-default',
    enabled: true,
    name: '共读助手',
    rolePrompt: '你是用户的论文共读伙伴。先完整理解论文，再围绕用户划线句子的上下文给出具体、克制、有判断的评论。',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    ...overrides,
  }
}

function normalizeSettingsPayload(payload: unknown): AppSettings {
  const raw = payload && typeof payload === 'object' ? payload as Partial<AppSettings> & { copilot?: Record<string, unknown> } : {}
  const rawCopilot: Record<string, unknown> = raw.copilot && typeof raw.copilot === 'object' ? raw.copilot : {}
  const rawAgents = Array.isArray(rawCopilot.agents) ? rawCopilot.agents : null

  const agents = rawAgents
    ? rawAgents
        .filter((item): item is Partial<CopilotAgentConfig> => Boolean(item && typeof item === 'object'))
        .map((agent, index) =>
          createDefaultCopilotAgent({
            id: String(agent.id || `agent-${index + 1}`),
            enabled: Boolean(agent.enabled ?? true),
            name: String(agent.name || `共读助手 ${index + 1}`),
            rolePrompt: String(agent.rolePrompt || createDefaultCopilotAgent().rolePrompt),
            apiKey: String(agent.apiKey || ''),
            baseUrl: String(agent.baseUrl || 'https://openrouter.ai/api/v1'),
            model: String(agent.model || ''),
          }),
        )
    : [
        createDefaultCopilotAgent({
          apiKey: String(rawCopilot.apiKey || ''),
          baseUrl: String(rawCopilot.baseUrl || 'https://openrouter.ai/api/v1'),
          model: String(rawCopilot.model || ''),
        }),
      ]

  return {
    mineru: {
      backend: raw.mineru?.backend === 'cloud' ? 'cloud' : 'local',
      modelVersion: raw.mineru?.modelVersion === 'vlm' ? 'vlm' : 'pipeline',
      parseMethod:
        raw.mineru?.parseMethod === 'txt' || raw.mineru?.parseMethod === 'ocr' ? raw.mineru.parseMethod : 'auto',
      apiToken: String(raw.mineru?.apiToken || ''),
      reuseExistingParse: Boolean(raw.mineru?.reuseExistingParse ?? true),
    },
    translation: {
      enabled: Boolean(raw.translation?.enabled),
      apiKey: String(raw.translation?.apiKey || ''),
      baseUrl: String(raw.translation?.baseUrl || 'https://api.deepseek.com/v1'),
      model: String(raw.translation?.model || 'deepseek-chat'),
      failRatioLimit: Number(raw.translation?.failRatioLimit ?? 0.2),
    },
    publish: {
      prepareOnly: Boolean(raw.publish?.prepareOnly ?? true),
      imageMode:
        raw.publish?.imageMode === 'strip' || raw.publish?.imageMode === 'keep' ? raw.publish.imageMode : 'note',
      folderToken: String(raw.publish?.folderToken || ''),
      appId: String(raw.publish?.appId || ''),
      appSecret: String(raw.publish?.appSecret || ''),
    },
    copilot: {
      agents: agents.length > 0 ? agents : [createDefaultCopilotAgent()],
    },
  }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    const message = await response.text()
    let parsedError: string | null = null
    try {
      const parsed = JSON.parse(message) as { error?: string }
      parsedError = parsed.error ?? null
    } catch {
      parsedError = null
    }
    throw new Error(parsedError || message || `请求失败: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchPapers() {
  return requestJson<PaperSummary[]>('/api/papers')
}

export function fetchAgentMemory(query = '') {
  const params = new URLSearchParams()
  if (query.trim()) {
    params.set('q', query.trim())
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return requestJson<AgentMemoryPayload>(`/api/agent-memory${suffix}`)
}

export function postAgentMemoryItem(payload: CreateAgentMemoryInput) {
  return requestJson<AgentMemoryPayload['items'][number]>(
    '/api/agent-memory',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function patchAgentMemoryItem(itemId: string, payload: UpdateAgentMemoryInput) {
  return requestJson<AgentMemoryPayload['items'][number]>(
    `/api/agent-memory/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function deleteAgentMemoryItem(itemId: string) {
  return requestJson<AgentMemoryPayload>(
    `/api/agent-memory/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function fetchMemoryCandidates() {
  return requestJson<MemoryCandidatePayload>('/api/memory/candidates')
}

export function postActivateMemoryCandidate(itemId: string) {
  return requestJson<MemoryCandidateItem>(
    `/api/memory/candidates/${encodeURIComponent(itemId)}/activate`,
    {
      method: 'POST',
    },
  )
}

export function postArchiveMemoryCandidate(itemId: string) {
  return requestJson<MemoryCandidateItem>(
    `/api/memory/candidates/${encodeURIComponent(itemId)}/archive`,
    {
      method: 'POST',
    },
  )
}

export function fetchPaperDetail(id: string) {
  return requestJson<PaperDetail>(`/api/papers/${encodeURIComponent(id)}`)
}

export function patchPaperLibrary(paperId: string, payload: UpdatePaperLibraryInput) {
  return requestJson<PaperSummary>(
    `/api/papers/${encodeURIComponent(paperId)}/library`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function fetchSearchResults(query: string, limit = 80) {
  const params = new URLSearchParams()
  params.set('q', query)
  params.set('limit', String(limit))
  return requestJson<SearchResult[]>(`/api/search?${params.toString()}`)
}

export function fetchReadingState(id: string) {
  return requestJson<ReadingState>(`/api/papers/${encodeURIComponent(id)}/reading-state`)
}

export function saveReadingState(
  id: string,
  payload: Omit<ReadingState, 'paperId' | 'updatedAt'>,
  options?: { keepalive?: boolean },
) {
  return requestJson<ReadingState>(
    `/api/papers/${encodeURIComponent(id)}/reading-state`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: options?.keepalive,
    },
  )
}

export function fetchPaperMemory(id: string) {
  return requestJson<PaperMemory>(`/api/papers/${encodeURIComponent(id)}/memory`)
}

export function postPaperNote(id: string, payload: CreatePaperNoteInput) {
  return requestJson<PaperMemory>(
    `/api/papers/${encodeURIComponent(id)}/notes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function postPaperMemoryItem(id: string, payload: CreatePaperMemoryItemInput) {
  return requestJson<PaperMemory>(
    `/api/papers/${encodeURIComponent(id)}/memory/items`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function postAnnotationMemoryItem(paperId: string, annotationId: string, payload: CreatePaperMemoryItemInput) {
  return requestJson<PaperMemory>(
    `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(annotationId)}/memory`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function patchPaperMemoryItem(paperId: string, itemId: string, payload: UpdatePaperMemoryItemInput) {
  return requestJson<PaperMemory>(
    `/api/papers/${encodeURIComponent(paperId)}/memory/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function deletePaperMemoryItem(paperId: string, itemId: string) {
  return requestJson<PaperMemory>(
    `/api/papers/${encodeURIComponent(paperId)}/memory/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function postPaperMemoryMarkdownExport(paperId: string) {
  return requestJson<PaperMemoryMarkdownExport>(
    `/api/papers/${encodeURIComponent(paperId)}/exports/markdown`,
    {
      method: 'POST',
    },
  )
}

export function fetchPaperAnnotations(id: string) {
  return requestJson<PaperAnnotation[]>(`/api/papers/${encodeURIComponent(id)}/annotations`)
}

export function fetchCopilotRuns(paperId: string) {
  return requestJson<CopilotRun[]>(`/api/papers/${encodeURIComponent(paperId)}/copilot-runs`)
}

export function postCopilotRun(paperId: string, payload: CreateCopilotRunInput) {
  return requestJson<CopilotRun>(
    `/api/papers/${encodeURIComponent(paperId)}/copilot-runs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function postCancelCopilotRun(paperId: string, runId: string) {
  return requestJson<CopilotRun>(
    `/api/papers/${encodeURIComponent(paperId)}/copilot-runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
    },
  )
}

export function postRetryCopilotRun(paperId: string, runId: string, agentId?: string) {
  return requestJson<CopilotRun>(
    `/api/papers/${encodeURIComponent(paperId)}/copilot-runs/${encodeURIComponent(runId)}/retry`,
    {
      method: 'POST',
      headers: agentId
        ? {
            'Content-Type': 'application/json',
          }
        : undefined,
      body: agentId ? JSON.stringify({ agentId }) : undefined,
    },
  )
}

export function postPaperAnnotation(id: string, payload: CreatePaperAnnotationInput) {
  return requestJson<PaperAnnotation[]>(
    `/api/papers/${encodeURIComponent(id)}/annotations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function postAnnotationComment(paperId: string, annotationId: string, payload: CreateAnnotationCommentInput) {
  return requestJson<PaperAnnotation[]>(
    `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(annotationId)}/comments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function patchAnnotationComment(
  paperId: string,
  annotationId: string,
  commentId: string,
  payload: UpdateAnnotationCommentInput,
) {
  return requestJson<PaperAnnotation[]>(
    `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(annotationId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function patchPaperAnnotation(paperId: string, annotationId: string, payload: UpdatePaperAnnotationInput) {
  return requestJson<PaperAnnotation[]>(
    `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(annotationId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function deletePaperAnnotation(paperId: string, annotationId: string) {
  return requestJson<PaperAnnotation[]>(
    `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(annotationId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function postOpenAction(paperId: string, target: 'rootDir' | 'contentListJson' | 'linearized' | 'bilingual' | 'feishuReady') {
  return requestJson<{ ok: boolean }>(
    '/api/actions/open',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paperId, target }),
    },
  )
}

export function postOpenRuntime() {
  return requestJson<{ ok: boolean }>(
    '/api/actions/open-runtime',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

export function fetchSettings() {
  return requestJson<unknown>('/api/settings').then((payload) => normalizeSettingsPayload(payload))
}

export function fetchCapabilities() {
  return requestJson<AppCapabilities>('/api/capabilities')
}

export function saveSettings(payload: AppSettings) {
  return requestJson<unknown>(
    '/api/settings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  ).then((response) => normalizeSettingsPayload(response))
}

export function postSettingsConnectionTest(target: 'mineru' | 'translation', settings: AppSettings) {
  return requestJson<ConnectionTestResult>(
    '/api/settings/test',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target, settings }),
    },
  )
}

export function fetchTasks() {
  return requestJson<ProcessingTask[]>('/api/tasks')
}

export function postRetryTask(taskId: string) {
  return requestJson<ProcessingTask>(
    `/api/tasks/${encodeURIComponent(taskId)}/retry`,
    {
      method: 'POST',
    },
  )
}

export async function postUploadPdf(file: File) {
  const response = await fetch('/api/tasks/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  })

  if (!response.ok) {
    const message = await response.text()
    let parsedError: string | null = null
    try {
      const parsed = JSON.parse(message) as { error?: string }
      parsedError = parsed.error ?? null
    } catch {
      parsedError = null
    }
    throw new Error(parsedError || message || `上传失败: ${response.status}`)
  }

  return response.json() as Promise<ProcessingTask>
}

export function postAnnotationAgentComment(paperId: string, payload: InvokeAnnotationAgentInput) {
  return requestJson<PaperAnnotation[]>(
    `/api/papers/${encodeURIComponent(paperId)}/annotations/agent-comment`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function fetchZoteroStatus() {
  return requestJson<ZoteroStatus>('/api/zotero/status')
}

export function fetchZoteroPapers(query = '') {
  const params = new URLSearchParams()
  if (query.trim()) {
    params.set('q', query.trim())
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return requestJson<ZoteroPaper[]>(`/api/zotero/items${suffix}`)
}

export function postImportZoteroPaper(attachmentKey: string) {
  return requestJson<ProcessingTask>(
    '/api/zotero/import',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attachmentKey }),
    },
  )
}
