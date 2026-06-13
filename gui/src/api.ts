import type {
  AppSettings,
  AppCapabilities,
  ConnectionTestResult,
  CreateAnnotationCommentInput,
  CreatePaperAnnotationInput,
  CreatePaperNoteInput,
  PaperAnnotation,
  PaperDetail,
  PaperMemory,
  PaperSummary,
  ProcessingTask,
  ReadingState,
  UpdateAnnotationCommentInput,
  UpdatePaperAnnotationInput,
} from '@/types'

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

export function fetchPaperDetail(id: string) {
  return requestJson<PaperDetail>(`/api/papers/${encodeURIComponent(id)}`)
}

export function fetchReadingState(id: string) {
  return requestJson<ReadingState>(`/api/papers/${encodeURIComponent(id)}/reading-state`)
}

export function saveReadingState(id: string, payload: Omit<ReadingState, 'paperId' | 'updatedAt'>) {
  return requestJson<ReadingState>(
    `/api/papers/${encodeURIComponent(id)}/reading-state`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

export function fetchPaperAnnotations(id: string) {
  return requestJson<PaperAnnotation[]>(`/api/papers/${encodeURIComponent(id)}/annotations`)
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
  return requestJson<AppSettings>('/api/settings')
}

export function fetchCapabilities() {
  return requestJson<AppCapabilities>('/api/capabilities')
}

export function saveSettings(payload: AppSettings) {
  return requestJson<AppSettings>(
    '/api/settings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
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
