import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchSearchResults,
  fetchAgentMemory,
  fetchMemoryCandidates,
  fetchMemoryResearchState,
  patchAgentMemoryItem,
  patchPaperLibrary,
  postActivateMemoryCandidate,
  postAgentMemoryItem,
  postArchiveMemoryCandidate,
  postAnnotationMemoryCandidates,
  postAnnotationMemoryItem,
  postCancelCopilotRun,
  postCopilotRun,
  postPaperMemoryMarkdownExport,
  postRetryCopilotRun,
  postSettingsConnectionTest,
  saveReadingState,
} from '@/api'
import type { AppSettings } from '@/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading state api', () => {
  it('uses fetch keepalive for final page-exit saves', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paperId: 'paper-1',
        view: 'linearized',
        scrollY: 42,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await saveReadingState(
      'paper-1',
      {
        view: 'linearized',
        scrollY: 42,
        activeSectionId: 'section-2',
        draft: null,
      },
      { keepalive: true },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/reading-state',
      expect.objectContaining({
        method: 'PUT',
        keepalive: true,
      }),
    )
  })
})

describe('agent memory api', () => {
  it('fetches and mutates global agent memory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        activeItems: [],
        relevantItems: [],
        itemCount: 0,
        activeCount: 0,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchAgentMemory('evidence memory')
    await postAgentMemoryItem({
      type: 'research_interest',
      text: 'Evidence-first long-term memory',
      tags: ['agent'],
    })
    await patchAgentMemoryItem('agent-memory-1', { status: 'archived' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agent-memory?q=evidence+memory', undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/agent-memory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'research_interest',
          text: 'Evidence-first long-term memory',
          tags: ['agent'],
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/agent-memory/agent-memory-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      }),
    )
  })
})

describe('paper memory api', () => {
  it('fetches and updates memory candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        count: 0,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchMemoryCandidates()
    await fetchMemoryResearchState()
    await postActivateMemoryCandidate('memory-1')
    await postArchiveMemoryCandidate('memory-2')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/memory/candidates', undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/memory/research-state',
      undefined,
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/memory/candidates/memory-1/activate',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/memory/candidates/memory-2/archive',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates memory from an annotation route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paperId: 'paper-1',
        title: 'Paper',
        items: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await postAnnotationMemoryItem('paper-1', 'annotation-1', {
      type: 'insight',
      text: 'A durable judgment',
      quote: 'Important quote',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/annotations/annotation-1/memory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'insight',
          text: 'A durable judgment',
          quote: 'Important quote',
        }),
      }),
    )
  })

  it('exports paper memory as markdown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        format: 'markdown',
        fileName: 'paper-memory.md',
        markdown: '# Paper',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await postPaperMemoryMarkdownExport('paper-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/exports/markdown',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('paper library api', () => {
  it('patches paper library metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'paper-1',
        title: 'Paper',
        favorite: true,
        tags: ['research'],
        readingStatus: 'done',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await patchPaperLibrary('paper-1', {
      favorite: true,
      tags: ['research'],
      readingStatus: 'done',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/library',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          favorite: true,
          tags: ['research'],
          readingStatus: 'done',
        }),
      }),
    )
  })
})

describe('copilot run api', () => {
  it('creates a persistent copilot run', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runId: 'run-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await postCopilotRun('paper-1', {
      annotationId: 'annotation-1',
      agentIds: ['agent-a'],
      runMode: 'explain',
      userMessage: 'Explain this',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/copilot-runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          annotationId: 'annotation-1',
          agentIds: ['agent-a'],
          runMode: 'explain',
          userMessage: 'Explain this',
        }),
      }),
    )
  })

  it('creates memory candidates from an agent comment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await postAnnotationMemoryCandidates('paper-1', 'annotation-1', {
      sourceCommentId: 'comment-1',
      runId: 'run-1',
      runMode: 'memory_candidate',
      items: [
        {
          type: 'insight',
          text: 'Keep this judgment',
          tags: ['method'],
          confidence: 0.78,
        },
      ],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/papers/paper-1/annotations/annotation-1/memory-candidates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sourceCommentId: 'comment-1',
          runId: 'run-1',
          runMode: 'memory_candidate',
          items: [
            {
              type: 'insight',
              text: 'Keep this judgment',
              tags: ['method'],
              confidence: 0.78,
            },
          ],
        }),
      }),
    )
  })

  it('cancels and retries a copilot run', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runId: 'run-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await postCancelCopilotRun('paper-1', 'run-1')
    await postRetryCopilotRun('paper-1', 'run-1', 'agent-a')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/papers/paper-1/copilot-runs/run-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/papers/paper-1/copilot-runs/run-1/retry',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ agentId: 'agent-a' }),
      }),
    )
  })
})

describe('search api', () => {
  it('fetches full-text search results with encoded query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchSearchResults('situated action', 12)

    expect(fetchMock).toHaveBeenCalledWith('/api/search?q=situated+action&limit=12', undefined)
  })
})

describe('settings api', () => {
  it('tests a selected copilot agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: 'ok' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const settings: AppSettings = {
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
      },
      publish: {
        prepareOnly: true,
        imageMode: 'note',
        folderToken: '',
        appId: '',
        appSecret: '',
      },
      copilot: {
        agents: [],
      },
    }

    await postSettingsConnectionTest('copilot_agent', settings, { agentId: 'agent-a' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          target: 'copilot_agent',
          settings,
          agentId: 'agent-a',
        }),
      }),
    )
  })

  it('uses server message text when a connection test fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ ok: false, message: '请先补齐智能体配置：模型' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      postSettingsConnectionTest('copilot_agent', {
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
        },
        publish: {
          prepareOnly: true,
          imageMode: 'note',
          folderToken: '',
          appId: '',
          appSecret: '',
        },
        copilot: {
          agents: [],
        },
      }),
    ).rejects.toThrow('请先补齐智能体配置：模型')
  })
})
