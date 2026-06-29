# cark Engineering Baseline

Date: 2026-06-19

This document records the current product surface before the long-term roadmap
changes the data model. It is intentionally concrete: routes, data shapes, and
verification gates.

## Current Verification Gates

- Frontend lint: `npm run lint` from `gui/`
- Frontend and Python tests: `npm test` from `gui/`
- Production build: `npm run build` from `gui/`
- Python syntax check: `python -m compileall -q cli.py scripts`

Latest local audit result on 2026-06-29: 19 frontend test files / 65 frontend
tests passed, 128 Python tests passed, lint and the production build passed,
Python compilation passed, `cark doctor` completed in the default demo profile,
`scripts/smoke_demo.ps1` completed the no-key demo research-memory flow, and
`git diff --check` reported no whitespace errors. This machine still reports
missing local parser dependencies (`onnxruntime` and `torch`) under
`cark doctor --profile local`, so local MinerU parsing remains an environment
setup item here.

## Runtime Data

- SQLite database: `runtime/cark.sqlite3`
- Parsed paper output: `runtime/output/`
- GUI uploads: `runtime/uploads/gui/`
- Per-paper memory and annotations: `runtime/memory/papers/{paperKey}/`
- Per-paper library metadata: `runtime/memory/papers/{paperKey}/library_meta.json`
- Per-paper copilot runs: `runtime/memory/papers/{paperKey}/copilot_runs/`
- Global agent memory: `runtime/memory/agent/memory.json`
- GUI settings: `config/gui_settings.json`

`paperKey` is the raw paper id only when it is short and filesystem-safe.
Long or unsafe ids use a stable `paper-{sha256}` key to avoid Windows path
length failures. Legacy raw-id paper directories are copied into the short
directory on read/write; migration is additive and does not delete or overwrite
existing files.

## Core Modules

- `scripts/gui_server.py`: HTTP server, settings, upload tasks, paper detail,
  annotations, reading state, copilot orchestration, Zotero, media serving.
- `scripts/gui_storage.py`: SQLite-backed tasks, papers, reading state, Zotero
  import mappings, and the persistent FTS5 search index.
- `scripts/gui_search.py`: search entry construction, persistent-index lookup,
  fallback scanning, ranking, snippets, and body-match locators.
- `scripts/gui_locator.py`: canonical server-side stable locator construction.
- `scripts/gui_memory.py`: paper memory storage, safe-id migration, atomic JSON
  writes, backups, schema versioning, and memory-item normalization.
- `scripts/gui_memory_engine.py`: shared memory provenance, confidence,
  activation, evidence, conflict, and revision-history normalization.
- `scripts/gui_agent_memory.py`: global agent memory storage and retrieval.
- `scripts/gui_library.py`: per-paper favorite, tag, and reading-status metadata.
- `scripts/gui_copilot_runs.py`: persistent Copilot run lifecycle and recovery.
- `scripts/gui_exports.py`: single-paper memory Markdown export formatting and
  file writing.
- `gui/src/api.ts`: browser API client.
- `gui/src/pages/Home.tsx`: library, upload, task center, Zotero import.
- `gui/src/pages/ReaderPage.tsx`: reader view, selection, annotations, reading
  state, copilot actions, paper memory drawer.
- `gui/src/hooks/useCopilotRuns.ts`: copilot run loading, polling, terminal
  annotation refresh, cancel, retry, and start actions.
- `gui/src/components/CommentLane.tsx`: annotation threads and copilot replies.
- `gui/src/components/PaperMemoryPanel.tsx`: per-paper memory drawer.

## Current API Surface

### App

- `GET /api/capabilities`
- `GET /api/settings`
- `POST /api/settings`
- `POST /api/settings/test`

### Agent Memory

- `GET /api/agent-memory?q=...`
- `POST /api/agent-memory`
- `PATCH /api/agent-memory/{itemId}`
- `DELETE /api/agent-memory/{itemId}`

Agent memory is global long-term context for intelligent agents, not a paper
note surface. It stores durable user/project/research context so copilot prompts
can retrieve relevant preferences and research direction across papers.

### Tasks

- `GET /api/tasks`
- `POST /api/tasks/upload`
- `POST /api/tasks/{taskId}/retry`

### Zotero

- `GET /api/zotero/status`
- `GET /api/zotero/items?q=...`
- `POST /api/zotero/import`

### Papers

- `GET /api/papers`
- `GET /api/papers/{paperId}`
- `PATCH /api/papers/{paperId}/library`
- `GET /api/search?q=...&limit=...`
- `POST /api/papers/{paperId}/exports/markdown`
- `POST /api/actions/open`
- `POST /api/actions/open-runtime`
- `GET /api/media/{paperId}?path=...`

Search results include `source`, `sourceLabel`, `snippet`, `view`,
`annotationId`, `memoryItemId`, `matchQuote`, match context, `locator`, and
`score`. The home page serializes the canonical locator into reader URLs; the
reader resolves block, annotation, comment, memory, and quote-context targets.

Markdown export currently writes a paper-memory `.md` file under the paper
memory `exports/` directory and returns `fileName`, `filePath`, `markdown`,
`createdAt`, and `itemCount`. The browser memory panel also downloads the
returned Markdown immediately.

### Reading State

- `GET /api/papers/{paperId}/reading-state`
- `PUT /api/papers/{paperId}/reading-state`

### Annotations

- `GET /api/papers/{paperId}/annotations`
- `POST /api/papers/{paperId}/annotations`
- `PATCH /api/papers/{paperId}/annotations/{annotationId}`
- `DELETE /api/papers/{paperId}/annotations/{annotationId}`
- `POST /api/papers/{paperId}/annotations/{annotationId}/comments`
- `PATCH /api/papers/{paperId}/annotations/{annotationId}/comments/{commentId}`
- `POST /api/papers/{paperId}/annotations/agent-comment`

### Copilot Runs

- `GET /api/papers/{paperId}/copilot-runs`
- `POST /api/papers/{paperId}/copilot-runs`
- `POST /api/papers/{paperId}/copilot-runs/{runId}/cancel`
- `POST /api/papers/{paperId}/copilot-runs/{runId}/retry`

Active copilot runs are stored per paper. On GUI server startup, queued or running
runs are re-queued and resumed. Active runs whose records are stale beyond the
server timeout window are marked `failed` with a retryable error instead of
remaining stuck in `running`.

### Paper Memory

- `GET /api/papers/{paperId}/memory`
- `POST /api/papers/{paperId}/notes`
- `POST /api/papers/{paperId}/memory/items`
- `PATCH /api/papers/{paperId}/memory/items/{itemId}`
- `DELETE /api/papers/{paperId}/memory/items/{itemId}`
- `POST /api/papers/{paperId}/annotations/{annotationId}/memory`
- `POST /api/papers/{paperId}/exports/markdown`

The legacy `POST /notes` route remains compatible and creates a `note` memory
item. New code should use `/memory/items`.

## Canonical Data Structures

### Paper

- `id`
- `title`
- `taskId`
- `updatedAt`
- `availableViews`
- `hasImages`
- `sourcePdf`
- `favorite`
- `tags`
- `readingStatus`
- `annotationCount`
- `memoryCount`
- `lastReadAt`
- `libraryUpdatedAt`
- `files`
- `markdown`
- `images`
- `stats`
- `blocks`

### Annotation

- `id`
- `paperId`
- `view`
- `quote`
- `contextBefore`
- `contextAfter`
- `anchorTop`
- `anchorHeight`
- `blockId`
- `locator`
- `createdAt`
- `updatedAt`
- `archived`
- `archivedAt`
- `comments`

### Reading State

- `paperId`
- `view`
- `scrollY`
- `activeSectionId`
- `draft`
- `updatedAt`
- `clientRevision`

### Memory Item

Current shape:

- `id`
- `paperId`
- `type`: `note`, `question`, `action`, or `insight`
- `text`
- `content`: compatibility alias for `text`
- `sourceAnnotationId`
- `quote`
- `anchor`
- `blockId`
- `blockPreview`
- `tags`
- `status`
- `memoryLayer`
- `source`
- `evidence`
- `confidence`
- `activationStatus`
- `derivedFrom`
- `conflictsWith`
- `revisionHistory`
- `locator`
- `createdAt`
- `updatedAt`

### Agent Memory Item

- `id`
- `type`: `profile`, `preference`, `research_interest`, `instruction`,
  `project`, or `concept`
- `text`
- `tags`
- `source`
- `confidence`
- `status`: `active` or `archived`
- `createdAt`
- `updatedAt`

### Processing Task

- `id`
- `fileName`
- `status`
- `stage`
- `progress`
- `createdAt`
- `updatedAt`
- `error`
- `logs`
- `result`

### Copilot Run

- `runId`
- `paperId`
- `annotationId`
- `agents`
- `status`: `queued`, `running`, `done`, `failed`, or `canceled`
- `userMessage`
- `followUpCommentId`
- `followUpAgentId`
- `results`
- `errors`
- `createdAt`
- `updatedAt`
- `startedAt`
- `finishedAt`
- `attempt`

## Current Risks

- `scripts/gui_server.py`, `ReaderPage.tsx`, and `CommentLane.tsx` remain too
  large even after the first module extractions.
- Search is persistent, but index refresh is still primarily a full rebuild;
  it needs per-paper content versions and incremental replacement.
- Exact body location can fall back from block ids to quote and surrounding
  context; locator recovery still needs more tests against edited documents.
- Single-paper memory Markdown export exists, but export history, background
  export tasks, multi-paper comparison, DOCX, and review-draft generation are
  still incomplete.
- Memory items carry candidate, confidence, provenance, conflict, and revision
  fields, but the automatic deduplication/conflict/activation decision pipeline
  is not implemented yet.
- Global question answering across papers, annotations, memory, and research
  history is not implemented yet.
