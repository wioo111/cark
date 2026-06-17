export type PaperView = 'linearized' | 'bilingual'
export type ParseBackend = 'local' | 'cloud'
export type MineruModelVersion = 'pipeline' | 'vlm'
export type ImageMode = 'strip' | 'note' | 'keep'

export interface PaperSummary {
  id: string
  title: string
  taskId: string | null
  updatedAt: string
  availableViews: PaperView[]
  hasImages: boolean
  sourcePdf?: string | null
}

export interface PaperStats {
  headingCount: number
  imageCount: number
  tableCount: number
  formulaCount: number
  paragraphCount: number
  blockCount: number
}

export interface PaperBlock {
  id: string
  index: number
  type: string
  pageIdx: number | null
  textLevel?: number | null
  preview: string
  matchText?: string | null
  imagePath?: string | null
  imageUrl?: string | null
  imageCaption?: string[]
  imageFootnote?: string[]
  bbox?: number[]
}

export interface PaperNote {
  id: string
  paperId: string
  content: string
  createdAt: string
  updatedAt: string
  blockId?: string | null
  blockPreview?: string | null
  quote?: string | null
  tags: string[]
}

export interface PaperMemory {
  paperId: string
  title: string
  summary: string
  anchors: string[]
  openQuestions: string[]
  recommendedActions: string[]
  noteCount: number
  lastUpdated: string | null
  recentNotes: PaperNote[]
}

export interface CreatePaperNoteInput {
  content: string
  blockId?: string | null
  blockPreview?: string | null
  quote?: string | null
  tags?: string[]
}

export type AnnotationAuthorType = 'user' | 'agent'
export type AnnotationCommentStatus = 'ready' | 'pending'

export interface AnnotationComment {
  id: string
  authorType: AnnotationAuthorType
  authorLabel: string
  agentId?: string | null
  replyToCommentId?: string | null
  replyToAgentId?: string | null
  content: string
  preview: string
  createdAt: string
  updatedAt: string
  status: AnnotationCommentStatus
}

export interface PaperAnnotation {
  id: string
  paperId: string
  view: PaperView
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop: number
  anchorHeight: number
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string | null
  comments: AnnotationComment[]
}

export interface CreatePaperAnnotationInput {
  view: PaperView
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop: number
  anchorHeight: number
  initialComment: {
    authorType: AnnotationAuthorType
    authorLabel: string
    content: string
    status?: AnnotationCommentStatus
  }
}

export interface CreateAnnotationCommentInput {
  authorType: AnnotationAuthorType
  authorLabel: string
  agentId?: string
  replyToCommentId?: string
  replyToAgentId?: string
  content: string
  status?: AnnotationCommentStatus
}

export interface UpdateAnnotationCommentInput {
  content: string
}

export interface UpdatePaperAnnotationInput {
  archived?: boolean
}

export interface InvokeAnnotationAgentInput {
  agentId: string
  annotationId?: string
  userMessage?: string
  followUpCommentId?: string
  draft?: {
    view: PaperView
    quote: string
    contextBefore?: string | null
    contextAfter?: string | null
    anchorTop: number
    anchorHeight: number
  }
}

export interface PaperDetail extends PaperSummary {
  rootDir: string
  files: {
    contentListJson?: string
    linearized?: string
    bilingual?: string
    feishuReady?: string
  }
  markdown: Partial<Record<PaperView, string>>
  images: Array<{
    name: string
    url: string
    filePath: string
  }>
  stats: PaperStats
  blocks: PaperBlock[]
}

export interface OutlineItem {
  id: string
  text: string
  translatedText?: string
  level: number
}

export interface CopilotAgentConfig {
  id: string
  enabled: boolean
  name: string
  rolePrompt: string
  apiKey: string
  baseUrl: string
  model: string
}

export interface AppSettings {
  mineru: {
    backend: ParseBackend
    modelVersion: MineruModelVersion
    parseMethod: 'auto' | 'txt' | 'ocr'
    apiToken: string
    reuseExistingParse: boolean
  }
  translation: {
    enabled: boolean
    apiKey: string
    baseUrl: string
    model: string
    failRatioLimit: number
  }
  publish: {
    prepareOnly: boolean
    imageMode: ImageMode
    folderToken: string
    appId: string
    appSecret: string
  }
  copilot: {
    agents: CopilotAgentConfig[]
  }
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  detail?: string | null
}

export interface AppCapabilities {
  ready: boolean
  issues: Array<{
    code: string
    message: string
    action: string
  }>
  localParser: {
    available: boolean
    message: string
  }
  cloudParser: {
    configured: boolean
    message: string
  }
  translation: {
    configured: boolean
    message: string
  }
}

export interface ReadingState {
  paperId: string
  view: PaperView
  scrollY: number
  clientRevision?: number
  activeSectionId?: string | null
  draft?: {
    view: PaperView
    quote: string
    contextBefore?: string | null
    contextAfter?: string | null
    anchorTop: number
    anchorHeight: number
    content: string
    mentionAgentIds?: string[]
  } | null
  updatedAt?: string | null
}

export type ProcessingTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'

export interface ProcessingTask {
  id: string
  fileName: string
  status: ProcessingTaskStatus
  stage: string
  progress: number
  createdAt: string
  updatedAt: string
  error?: string | null
  logs: string[]
  result?: {
    paperId?: string | null
    paperTitle?: string | null
    output?: Record<string, unknown> | null
  } | null
}

export interface ZoteroStatus {
  available: boolean
  version?: string | null
  message: string
}

export interface ZoteroPaper {
  itemKey: string
  attachmentKey: string
  title: string
  creators: string[]
  year?: string | null
  fileName: string
  imported: boolean
  taskId?: string | null
}
