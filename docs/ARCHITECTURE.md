# Architecture

## Product boundary

cark is the application users interact with. It owns the paper library, processing state, reader, annotations, source locations, and knowledge review experience.

External model or agent systems are implementation details behind an adapter. They must not own cark's paper identifiers or become a second user interface.

## Repository layout

```text
cark/
├─ cli.py                 Command-line entry point and process orchestration
├─ config/                Committable configuration templates
├─ gui/                   React and Vite user interface
├─ patches/               Isolated compatibility patches
├─ scripts/               Python pipelines and local HTTP server
├─ runtime/               Local data and generated output, never committed
└─ docs/                  Architecture and development documentation
```

## Current runtime

```text
React UI
   |
   | HTTP / JSON
   v
scripts/gui_server.py
   |
   +-- MinerU local or cloud parsing
   +-- translation pipeline
   +-- local paper, annotation, and task files
```

The current server is intentionally dependency-light, but it is too large to remain a single module. New backend work should move toward explicit boundaries:

- `domain`: papers, annotations, reading sessions, and memory references
- `storage`: SQLite metadata and filesystem assets
- `pipeline`: parsing, translation, and export jobs
- `agent`: model and agent backend adapters
- `http`: request validation, routing, and streaming responses

## Data ownership

- SQLite should store metadata, task state, annotations, session mappings, and migrations.
- The filesystem should store PDFs, parsed Markdown, images, and generated documents.
- Model credentials remain local and must never enter Git.
- Long-term user memory may be delegated to Hermes or another provider, but cark retains source references and user-visible controls.

## Near-term constraint

Do not reorganize all Python scripts in one mechanical move. Extract one boundary at a time with tests so existing CLI and pipeline paths remain usable.
