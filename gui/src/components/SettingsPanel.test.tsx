// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchSettings,
  postSettingsConnectionTest,
  saveSettings,
} from '@/api'
import { SettingsPanel } from '@/components/SettingsPanel'
import type { AppSettings } from '@/types'

vi.mock('@/api', () => ({
  fetchSettings: vi.fn(),
  postSettingsConnectionTest: vi.fn(),
  saveSettings: vi.fn(),
}))

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchSettings).mockResolvedValue(baseSettings())
    vi.mocked(saveSettings).mockResolvedValue(baseSettings())
    vi.mocked(postSettingsConnectionTest).mockResolvedValue({
      ok: true,
      message: 'Reviewer 可用于共读',
      detail: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('blocks saving enabled agents that are missing required fields', () => {
    const settings = baseSettings({
      copilot: {
        agents: [
          {
            ...completeAgent(),
            model: '',
          },
        ],
      },
    })

    renderPanel(settings)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getAllByText(/缺少：模型/).length).toBeGreaterThan(0)
  })

  it('tests and copies copilot agent configuration', async () => {
    const settings = baseSettings({
      copilot: {
        agents: [completeAgent()],
      },
    })

    renderPanel(settings)

    fireEvent.click(screen.getByRole('button', { name: '测试智能体' }))

    await waitFor(() => {
      expect(postSettingsConnectionTest).toHaveBeenCalledWith('copilot_agent', settings, { agentId: 'agent-a' })
      expect(screen.getByText('Reviewer 可用于共读')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    expect(screen.getByDisplayValue('Reviewer 副本')).toBeInTheDocument()
    expect(screen.getAllByText(/已禁用/).length).toBeGreaterThan(0)
  })
})

function renderPanel(settings: AppSettings) {
  return render(
    <SettingsPanel
      open
      settings={settings}
      capabilities={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
}

function completeAgent() {
  return {
    id: 'agent-a',
    enabled: true,
    name: 'Reviewer',
    description: 'Checks evidence.',
    rolePrompt: 'Find weak evidence.',
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    model: 'model-a',
  }
}

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
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
      agents: [completeAgent()],
    },
    ...overrides,
  }
}
