# cark repository instructions

## Scope

- cark is a local-first paper reading workspace.
- Keep the user-facing workflow in `gui/` and the Python orchestration in `cli.py` and `scripts/`.
- Runtime data, credentials, generated files, and machine-specific paths must not be committed.

## Working agreements

- Prefer small changes that preserve the upload, parsing, translation, reading, and annotation workflow.
- Do not add a production dependency without explaining why the standard library or an existing dependency is insufficient.
- Keep API contracts synchronized between `gui/src/api.ts`, `gui/src/types.ts`, and `scripts/gui_server.py`.
- Treat paper content as untrusted input and preserve source locations for generated answers or memories.

## Verification

- After frontend changes, run `npm run lint`, `npm test`, and `npm run build` from `gui/`.
- After Python changes, run `python -m compileall -q cli.py scripts`.
- Do not commit `config/mineru.json`, `config/gui_settings.json`, `runtime/`, `.venv/`, `gui/node_modules/`, or `gui/dist/`.

## Git

- `main` is the only long-lived branch.
- Use short-lived branches such as `codex/<topic>` for isolated changes and delete them after merge.
- Never rewrite shared branch history unless explicitly requested.
