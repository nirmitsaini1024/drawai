# DrawAI

A web whiteboard similar to Excalidraw / tldraw, with a reusable custom-shape library, built-in presets, and an AI assistant that builds diagrams from natural language.

**Stack:** React + TypeScript + Vite · tldraw · Zustand · Tailwind · IndexedDB (`idb-keyval`, offline cache) · FastAPI + SQLAlchemy (async) + Alembic · PostgreSQL 16 · Node sync server (`@tldraw/sync-core`, `pg`) · Docker Compose + nginx

> ## ⚠️ No authentication
> DrawAI has **no login and no user accounts**. Anyone who can reach the web port can read, edit and delete every board and use your AI key. Do **not** expose it to the internet as-is. Keep the default `127.0.0.1` binding, or put it behind a reverse proxy that enforces login (e.g. oauth2-proxy, Authelia, Caddy `basic_auth`) or a VPN (WireGuard/Tailscale). Share links give *board-level* access to whoever holds the link, nothing more.

## Run with Docker (recommended)

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD (letters/digits only) and OPENROUTER_API_KEY
docker compose up -d --build
# → http://localhost:8080
```

Services: `postgres` (named volume `pgdata`), `api` (FastAPI; runs `alembic upgrade head` on start), `sync` (Node WebSocket sync), `web` (Vite build served by nginx, proxying `/api` → api and `/connect` → sync). Every service has a healthcheck and runs as a non-root user; the web port is bound to `127.0.0.1` by default (`WEB_BIND`).

```bash
docker compose ps                  # all services should become "healthy"
docker compose logs -f api sync    # follow logs
docker compose down                # stop (data is kept in the pgdata volume)
docker compose down -v             # stop AND delete the database volume
```

**Dev with hot reload** (Vite :5173, uvicorn `--reload` :8000, `node --watch` sync :8787, Postgres :5432; needs Compose ≥ 2.24):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_DB` / `POSTGRES_PASSWORD` | compose | Database credentials (password is required; use letters/digits) |
| `DATABASE_URL` | api, sync | Built by compose. API: `postgresql+asyncpg://…`; sync accepts either scheme |
| `OPENROUTER_API_KEY` (alias `ANTHROPIC_API_KEY`) | api | AI provider key |
| `MODEL` | api | Model id (default `deepseek/deepseek-v4.1-flash-1017`) |
| `WEB_ORIGIN` | api | Comma-separated browser origins allowed by CORS |
| `WEB_PORT` / `WEB_BIND` | compose | Published port / bind address of the web container |
| `TRUST_PROXY` | api | `1` behind nginx so per-IP rate limits use `X-Forwarded-For` (set by compose) |
| `MAX_SNAPSHOT_BYTES` | api | Snapshot size limit (default 20 MB) |
| `VITE_API_BASE_URL` / `VITE_SYNC_WS_URL` | web build/dev | Unset = local defaults; **empty** = same origin (Docker build) |

### Migrations

The API container applies migrations automatically on start. To run them by hand:

```bash
docker compose run --rm api alembic upgrade head          # in Docker
cd server && .venv/bin/alembic upgrade head               # local (uses DATABASE_URL)
cd server && .venv/bin/alembic revision -m "describe change"   # new migration
```

### Backups

```bash
scripts/backup.sh                                   # → backups/drawai-<UTC timestamp>.sql.gz (pg_dump)
scripts/restore.sh backups/drawai-<timestamp>.sql.gz   # asks first; stops app services, restores, restarts
```

`backups/` is git-ignored. Keep copies off the machine; the dump contains all boards.

## Setup without Docker

You need a PostgreSQL 16 database (e.g. `docker run -d -p 5432:5432 -e POSTGRES_USER=drawai -e POSTGRES_PASSWORD=drawai -e POSTGRES_DB=drawai postgres:16-alpine`).

```bash
npm install
cp .env.example .env

python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements-dev.txt
cp server/.env.example server/.env
# edit server/.env: OPENROUTER_API_KEY, DATABASE_URL, optional MODEL
(cd server && .venv/bin/alembic upgrade head)
```

Three processes (or `npm run dev:all`; the sync server reads `DATABASE_URL` from your shell):

```bash
# Terminal 1 — API (reads server/.env)
npm run dev:server                 # http://localhost:8000  (health: GET /api/health)

# Terminal 2 — sync server
DATABASE_URL=postgresql://drawai:drawai@localhost:5432/drawai npm run dev:sync   # ws://localhost:8787/connect/:roomId

# Terminal 3 — Vite app
npm run dev                        # http://localhost:5173
```

## Scripts

| Command              | Description                              |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | Vite frontend                            |
| `npm run dev:server` | FastAPI backend on :8000                 |
| `npm run dev:sync`   | tldraw sync WebSocket server on :8787    |
| `npm run dev:all`    | Frontend + API + sync together           |
| `npm run build`      | Typecheck + production build             |
| `npm run preview`    | Preview production build                 |
| `npm run sync:kinds` | Copy preset kinds JSON → `server/`       |
| `npm run test:sync`  | Sync-server tests (view-only enforcement, token auth, revocation) |
| `npm run import:rooms` | Import legacy `sync-server/.rooms/*.json` into Postgres |
| `cd server && .venv/bin/python -m pytest` | API tests (board CRUD, 409 conflicts, library, share links) |

## How persistence works

- **Server is the source of truth** (Postgres, JSONB snapshots; names/timestamps in normal columns).
- **IndexedDB is an offline cache.** Every change is written there instantly, then pushed to the API in the background (debounced ~3 s). The top bar shows **Saved / Saving / Offline / Conflict**.
- **Last-write-wins by `updated_at`.** `PUT /api/boards/{id}` takes the client's `expected_updated_at`; a mismatch returns `409` with the server copy and the client keeps whichever is newer. There is no offline merge.
- **Offline:** edits queue in IndexedDB and flush automatically when the server is reachable again.
- **On load** the local copy shows immediately, then the server copy replaces it if newer.
- **Existing local data:** if boards/shapes exist only in this browser (from before server sync) a banner offers **Import local data to the server**.
- Settings (theme, grid, active board) stay per-browser.

## Sharing & live collaboration

- **Share** → pick *Can edit* or *View only* → **Create link**. Links look like `#/s/<token>`; tokens are 256-bit random values stored only as SHA-256 hashes (the URL is shown once, at creation or rotation).
- The sync server checks the token against `room_links` on every connect, takes the role from the database (view-only is enforced server-side: write messages from view-only sessions are dropped), and closes live sockets when a link is revoked (within a few seconds).
- **Revoke** removes access; **Rotate** replaces the URL and keeps the role.
- A board's live room is saved to Postgres (debounced 2 s after the last change and on last disconnect, skipped if nothing changed) and written back into the board, so the owner sees collaborators' edits.
- Images are stored inline in snapshots as tldraw does by default; there is no object storage.

### Importing old room files

```bash
DATABASE_URL=postgresql://drawai:…@localhost:5432/drawai npm run import:rooms
```

Existing rows are never overwritten. `sync-server/.rooms/` is no longer used and is git-ignored.

## Phase status

- [x] **Phase 1** — Full-screen tldraw, top bar, IndexedDB boards, export/import, theme
- [x] **Phase 2** — Save-as-shape library
- [x] **Phase 3** — Preset `icon` shapes
- [x] **Phase 4** — Productivity (command palette, align, shortcuts, …)
- [x] **Phase 5** — AI diagram generation (FastAPI + dagre)
- [x] **Phase 6** — Extra AI (selection actions, image→diagram, Mermaid, edit selection)
- [x] **Phase 7** — Real-time collaboration, share links, read-only mode

## Project layout

```
src/components   UI chrome (top bar, drawers, menus)
src/shapes       Custom ShapeUtils (Phase 3+)
src/library      Presets + user library helpers
src/ai           AI client + graph → shapes
src/store        Zustand stores
src/lib          Persistence, export, shared types
server/          FastAPI LLM proxy (Phase 5+)
public/presets   Static preset assets if needed
```

## Phase 1 — how to test

1. `npm run dev` — canvas fills the window under the top bar.
2. Draw shapes; wait ~1s — status shows **Saved**.
3. Rename the board in the top bar; refresh — name and drawing restore.
4. **Boards** → New / rename / delete / switch boards.
5. **Export** PNG, SVG, JSON; **Import JSON** reloads a board.
6. **Dark / Light** toggles app chrome and tldraw theme.

## Phase 2 — how to test

1. Draw/select shapes → **Save as shape** (button, right-click, or Ctrl/Cmd+Shift+U).
2. Enter name + category → item appears under **Shapes → My shapes**.
3. Click a library item (or drag onto the canvas) to insert a copy with new IDs.
4. Hover a card → ··· → rename / change category / delete.
5. **My shapes** Export / Import JSON (merge or replace).
6. Refresh — library persists in IndexedDB.

## Phase 3 — how to test

1. Open **Shapes** → **Presets**; filter by category / search.
2. Click (or drag) a preset onto the canvas — creates an `icon` shape.
3. Resize and rotate the shape; change color in the style panel.
4. Double-click the label to edit text; Enter / blur to commit.
5. **My shapes** tab still shows Phase 2 saved shapes.
6. Add a new preset later by editing `presetKinds.ts`, `presetIcons.tsx`, and `presets.ts`.

## Phase 4 — how to test

1. **⌘/Ctrl+K** (or top-bar ⌘K) — command palette: insert preset, AI stub, export, theme, zoom to fit, align/distribute, etc.
2. **?** in the top bar or **⌘/Ctrl+Alt+/** — shortcuts cheat sheet (DrawAI + built-in).
3. Grid: **⌘/Ctrl+'** · Always snap: **⌘/Ctrl+Shift+M** · Theme: **⌘/Ctrl+Shift+D** or **⌘/Ctrl/**
4. Sticky note **N**, text **T**, frame **F**; Actions menu for align / distribute / group / lock.
5. Save as shape is **⌘/Ctrl+Shift+U** (avoids browser Save As).
6. Type in an input — canvas shortcuts should not fire.

## Phase 5 / AI chat — how to test

1. Put your key in `server/.env` (`OPENROUTER_API_KEY=…`, `MODEL=deepseek/deepseek-v4.1-flash-1017`).
2. Start backend + frontend (commands above).
3. **Generate new:** bottom-right **AI** button, **⌘/Ctrl+I** (no selection), or **⌘/Ctrl+Shift+I** — popover → “Generate new”.
4. **Edit selection:** select shapes → **Ask AI** chip under selection (or ⌘/Ctrl+I) → chat popover anchored to selection.
5. Switch tabs in the popover: **Edit selection** ↔ **Generate new**.
6. Enter sends; Esc closes; edit mode keeps Accept/Reject preview.

## Edit selection with AI — how to test

1. Select one or more shapes on the canvas.
2. Press **Ctrl/Cmd+I** (or context menu / command palette) — popover appears under the selection.
3. Empty selection → toast “Nothing selected”.
4. Type an instruction (or click a quick-action chip) → Enter submits; Esc closes; popover stays open for follow-ups.
5. Accept / Reject the preview; Reject uses `bailToMark` so one undo-level reverts the patch.
6. Backend: `POST /api/edit` returns patch ops only (`update` / `create` / `delete` / `connect`).

## Phase 6 — how to test

1. **Selection actions** (right-click selection or ⌘K): Clean up layout · Explain this · Turn into flowchart · Summarize as sticky note.
2. **Image→diagram**: Top bar **Image→AI** (or command palette) → upload a sketch photo → Convert.
3. **Mermaid**: Top bar **Mermaid** → paste a `flowchart`/`graph` → Import (simple graphs parse locally; complex ones use the model).
4. Restart backend after pull so new routes load: `/api/diagram/from-image`, `/api/mermaid`, `/api/explain`.

## Phase 7 — how to test

1. Start the stack (`docker compose up -d --build`, or the three dev processes).
2. On a board click **Share** → *Can edit* → **Create link** → **Open live board** (or copy the URL).
3. Open the **edit link** in another browser/profile — cursors + edits sync live.
4. Create a *View only* link and open it — banner “View only · live”; drawing tools disabled (and the server drops writes anyway).
5. **Revoke** the link in the Share dialog — the other browser is disconnected within a few seconds and the link no longer opens.
6. **Leave** returns to your boards. Health: `curl http://localhost:8080/api/health` (Docker) or `:8787/health` (sync).
