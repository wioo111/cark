import { create } from 'zustand'

import { fetchPapers } from '@/api'
import type { PaperSummary } from '@/types'

interface WorkspaceState {
  papers: PaperSummary[]
  loading: boolean
  error: string | null
  recentPaperIds: string[]
  refreshPapers: () => Promise<void>
  rememberPaper: (id: string) => void
  updatePaper: (paper: PaperSummary) => void
}

const RECENT_KEY = 'cark-gui-recent-paper-ids'

function loadRecentPaperIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function saveRecentPaperIds(ids: string[]) {
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  papers: [],
  loading: false,
  error: null,
  recentPaperIds: loadRecentPaperIds(),
  refreshPapers: async () => {
    set({ loading: true, error: null })
    try {
      const papers = await fetchPapers()
      set({ papers, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '加载论文列表失败',
      })
    }
  },
  rememberPaper: (id) => {
    set((state) => {
      const recentPaperIds = [id, ...state.recentPaperIds.filter((item) => item !== id)].slice(0, 6)
      saveRecentPaperIds(recentPaperIds)
      return { recentPaperIds }
    })
  },
  updatePaper: (paper) => {
    set((state) => ({
      papers: state.papers.map((item) => (item.id === paper.id ? { ...item, ...paper } : item)),
    }))
  },
}))
