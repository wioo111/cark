export type PaperView = 'linearized' | 'bilingual'
export type PaperReadingStatus = 'unread' | 'reading' | 'done'
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
  favorite?: boolean
  tags?: string[]
  readingStatus?: PaperReadingStatus
  annotationCount?: number
  memoryCount?: number
  lastReadAt?: string | null
  libraryUpdatedAt?: string | null
}

export interface UpdatePaperLibraryInput {
  favorite?: boolean
  tags?: string[]
  readingStatus?: PaperReadingStatus
}

export type AgentMemoryType = 'profile' | 'preference' | 'research_interest' | 'instruction' | 'project' | 'concept'
export type AgentMemoryStatus = 'active' | 'archived'
export type MemoryActivationStatus = 'candidate' | 'active' | 'archived'

export interface MemoryRevision {
  updatedAt: string
  reason: string
  text: string
  status: string
  activationStatus: MemoryActivationStatus
  confidence: number
}

export interface AgentMemorySource {
  kind?: string
  paperId?: string
  annotationId?: string
  commentId?: string
  runId?: string
  memoryId?: string
  note?: string
  userAction?: string
}

export interface MemoryEvidence {
  kind?: string
  quote?: string
  contextBefore?: string
  contextAfter?: string
  blockId?: string
  annotationId?: string
  commentId?: string
  view?: PaperView
}

export interface StableLocator {
  view?: PaperView | null
  annotationId?: string | null
  commentId?: string | null
  memoryItemId?: string | null
  blockId?: string | null
  quote?: string | null
  contextBefore?: string | null
  contextAfter?: string | null
}

export interface AgentMemoryItem {
  id: string
  memoryLayer?: 'global'
  type: AgentMemoryType
  text: string
  tags: string[]
  source?: AgentMemorySource | null
  evidence?: MemoryEvidence[]
  confidence: number
  status: AgentMemoryStatus
  activationStatus?: MemoryActivationStatus
  derivedFrom?: string[]
  conflictsWith?: string[]
  revisionHistory?: MemoryRevision[]
  createdAt: string
  updatedAt: string
}

export interface AgentMemoryPayload {
  items: AgentMemoryItem[]
  activeItems: AgentMemoryItem[]
  candidateItems?: AgentMemoryItem[]
  relevantItems: AgentMemoryItem[]
  itemCount: number
  activeCount: number
  candidateCount?: number
  lastUpdated?: string | null
}

export type MemoryCandidateLayer = 'paper' | 'global'

export type MemoryCandidateItem = (PaperMemoryItem | AgentMemoryItem) & {
  layer: MemoryCandidateLayer
  paperId?: string | null
  paperTitle?: string | null
  locator?: StableLocator | null
}

export interface MemoryCandidatePayload {
  items: MemoryCandidateItem[]
  count: number
}

export type ResearchMemoryItem = PaperMemoryItem & {
  layer: 'paper'
  paperId: string
  paperTitle: string
  locator?: StableLocator | null
}

export interface MemoryResearchStatePayload {
  recentInsights: ResearchMemoryItem[]
  openQuestions: ResearchMemoryItem[]
  insightCount: number
  openQuestionCount: number
}

export interface CreateAgentMemoryInput {
  type: AgentMemoryType
  text: string
  tags?: string[]
  source?: AgentMemorySource | null
  evidence?: MemoryEvidence[]
  confidence?: number
  status?: AgentMemoryStatus
  activationStatus?: MemoryActivationStatus
  derivedFrom?: string[]
  conflictsWith?: string[]
}

export type UpdateAgentMemoryInput = Partial<CreateAgentMemoryInput>

export type SearchResultSource = 'title' | 'body' | 'annotation' | 'memory'

export interface SearchResult {
  id: string
  paperId: string
  paperTitle: string
  source: SearchResultSource
  sourceLabel: string
  snippet: string
  score: number
  view?: PaperView | null
  annotationId?: string | null
  memoryItemId?: string | null
  locator?: StableLocator | null
  matchQuote?: string | null
  matchContextBefore?: string | null
  matchContextAfter?: string | null
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

export type MemoryItemType = 'note' | 'question' | 'action' | 'insight'
export type MemoryItemStatus = 'active' | 'done' | 'archived'

export interface PaperMemoryAnchor {
  view?: PaperView | null
  quote?: string | null
  contextBefore?: string | null
  contextAfter?: string | null
  anchorTop?: number | null
  anchorHeight?: number | null
}

export interface PaperMemoryItem {
  id: string
  paperId: string
  memoryLayer?: 'paper'
  type: MemoryItemType
  text: string
  content: string
  sourceAnnotationId?: string | null
  source?: AgentMemorySource | null
  locator?: StableLocator | null
  anchor?: PaperMemoryAnchor | null
  createdAt: string
  updatedAt: string
  blockId?: string | null
  blockPreview?: string | null
  quote?: string | null
  evidence?: MemoryEvidence[]
  confidence?: number
  tags: string[]
  status: MemoryItemStatus
  activationStatus?: MemoryActivationStatus
  derivedFrom?: string[]
  conflictsWith?: string[]
  revisionHistory?: MemoryRevision[]
}

export type PaperNote = PaperMemoryItem

export interface PaperMemory {
  paperId: string
  title: string
  summary: string
  anchors: string[]
  openQuestions: string[]
  recommendedActions: string[]
  noteCount: number
  lastUpdated: string | null
  items: PaperMemoryItem[]
  activeItems?: PaperMemoryItem[]
  candidateItems?: PaperMemoryItem[]
  activeCount?: number
  candidateCount?: number
  notes: PaperMemoryItem[]
  questions: PaperMemoryItem[]
  actions: PaperMemoryItem[]
  insights: PaperMemoryItem[]
  recentNotes: PaperNote[]
}

export interface PaperMemoryMarkdownExport {
  paperId: string
  title: string
  format: 'markdown'
  fileName: string
  filePath: string
  markdown: string
  createdAt: string
  itemCount: number
}

export interface CreatePaperNoteInput {
  type?: MemoryItemType
  content: string
  text?: string
  blockId?: string | null
  blockPreview?: string | null
  sourceAnnotationId?: string | null
  quote?: string | null
  anchor?: PaperMemoryAnchor | null
  tags?: string[]
  status?: MemoryItemStatus
  source?: AgentMemorySource | null
  evidence?: MemoryEvidence[]
  confidence?: number
  activationStatus?: MemoryActivationStatus
  derivedFrom?: string[]
  conflictsWith?: string[]
}

export interface CreatePaperMemoryItemInput {
  type: MemoryItemType
  text: string
  sourceAnnotationId?: string | null
  quote?: string | null
  anchor?: PaperMemoryAnchor | null
  blockId?: string | null
  blockPreview?: string | null
  tags?: string[]
  status?: MemoryItemStatus
  source?: AgentMemorySource | null
  evidence?: MemoryEvidence[]
  confidence?: number
  activationStatus?: MemoryActivationStatus
  derivedFrom?: string[]
  conflictsWith?: string[]
}

export interface AgentCommentMemoryCandidateInput {
  type: MemoryItemType
  text: string
  tags?: string[]
  confidence?: number
  evidenceQuote?: string | null
}

export interface CreateMemoryCandidatesFromAgentCommentInput {
  sourceCommentId: string
  agentId?: string | null
  runId?: string | null
  runMode?: CopilotRunMode
  items: AgentCommentMemoryCandidateInput[]
}

export interface CreatedMemoryCandidatesPayload {
  created: PaperMemoryItem[]
}

export interface UpdatePaperMemoryItemInput {
  type?: MemoryItemType
  text?: string
  content?: string
  sourceAnnotationId?: string | null
  quote?: string | null
  anchor?: PaperMemoryAnchor | null
  blockId?: string | null
  blockPreview?: string | null
  tags?: string[]
  status?: MemoryItemStatus
  source?: AgentMemorySource | null
  evidence?: MemoryEvidence[]
  confidence?: number
  activationStatus?: MemoryActivationStatus
  derivedFrom?: string[]
  conflictsWith?: string[]
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
  locator?: StableLocator | null
  runMode?: CopilotRunMode
  structuredOutput?: boolean
  structuredOutputError?: string | null
  openQuestions?: string[]
  memoryCandidateIds?: string[]
  memoryCandidateCount?: number
  memoryCandidateErrors?: string[]
  createdAt: string
  updatedAt: string
  status: AnnotationCommentStatus
}

export type CopilotRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'
export type CopilotRunMode = 'comment' | 'critique' | 'explain' | 'memory_candidate'

export interface CopilotRunResult {
  agentId?: string
  commentId?: string | null
  runMode?: CopilotRunMode
  structuredOutput?: boolean
  structuredOutputError?: string | null
  memoryCandidateIds?: string[]
  memoryCandidateCount?: number
  memoryCandidateErrors?: string[]
  openQuestions?: string[]
  createdAt?: string
}

export interface CopilotRunAgent {
  agentId: string
  agentName: string
  status: CopilotRunStatus
  resultCommentId?: string | null
  memoryCandidateIds?: string[]
  error?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface CopilotRun {
  runId: string
  paperId: string
  annotationId: string
  agents: CopilotRunAgent[]
  status: CopilotRunStatus
  runMode: CopilotRunMode
  userMessage: string
  followUpCommentId?: string | null
  followUpAgentId?: string | null
  results: CopilotRunResult[]
  errors: Array<{ agentId?: string; message?: string; createdAt?: string }>
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  finishedAt?: string | null
  attempt: number
}

export interface CreateCopilotRunInput {
  annotationId: string
  agentIds: string[]
  runMode?: CopilotRunMode
  userMessage?: string
  followUpCommentId?: string
  followUpAgentId?: string
}

export interface PaperAnnotation {
  id: string
  paperId: string
  view: PaperView
  quote: string
  contextBefore?: string | null
  contextAfter?: string | null
  blockId?: string | null
  locator?: StableLocator | null
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
  blockId?: string | null
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
