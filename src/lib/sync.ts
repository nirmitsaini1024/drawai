/**
 * Background sync between the IndexedDB cache and the API (server = source of truth).
 *
 *  - local writes mark items dirty and schedule a debounced push (~3s)
 *  - pushes use optimistic concurrency (`expected_updated_at`); on conflict the newer
 *    `updated_at` wins (last-write-wins, no merging)
 *  - when the server is unreachable, changes stay queued (dirty flags + delete queue in IndexedDB)
 *    and are flushed when connectivity returns
 */
import type { TLEditorSnapshot } from 'tldraw'
import type { LibraryShape } from '../library/types'
import {
  ApiError,
  createBoardOnServer,
  createLibraryShapeOnServer,
  deleteBoardOnServer,
  deleteLibraryShapeOnServer,
  getBoard,
  isOfflineError,
  listBoards,
  listLibraryOnServer,
  updateBoardOnServer,
  updateLibraryShapeOnServer,
  type ServerBoard,
  type ServerLibraryShape,
} from './api'
import {
  deleteLocalBoard,
  loadLocalBoard,
  loadLocalBoardIndex,
  loadLocalLibrary,
  loadSyncMeta,
  saveLocalBoard,
  saveLocalBoardIndex,
  saveLocalLibrary,
  updateSyncMeta,
  type SyncMeta,
} from './localDb'
import { useSyncStatus, type LegacyCounts } from './syncStatus'
import type { BoardMeta, BoardRecord } from './types'

export const PUSH_DEBOUNCE_MS = 3000
const RETRY_MS = 15_000
const FOCUS_RECONCILE_MS = 30_000

const ms = (iso: string) => Date.parse(iso)
const status = () => useSyncStatus.getState()

// ---- Change notifications ---------------------------------------------------

export type RemoteBoardChange = { changed: string[]; removed: string[] }
const boardListeners = new Set<(c: RemoteBoardChange) => void>()
const libraryListeners = new Set<() => void>()

/** Fired when server data replaced/removed local boards (the store reloads the editor if needed). */
export function onRemoteBoardChange(cb: (c: RemoteBoardChange) => void): () => void {
  boardListeners.add(cb)
  return () => boardListeners.delete(cb)
}
export function onRemoteLibraryChange(cb: () => void): () => void {
  libraryListeners.add(cb)
  return () => libraryListeners.delete(cb)
}

// ---- Small utilities --------------------------------------------------------

let lock: Promise<unknown> = Promise.resolve()
/** Pushes and reconciles never overlap. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn)
  lock = run.catch(() => undefined)
  return run
}

function pendingCount(m: SyncMeta): number {
  return (
    Object.values(m.boards).filter((b) => b.dirty).length +
    Object.values(m.library).filter((l) => l.dirty).length +
    m.deletedBoards.length +
    m.deletedLibrary.length
  )
}

async function refreshPending(): Promise<number> {
  const n = pendingCount(await loadSyncMeta())
  status().setPending(n)
  return n
}

const toBoardMeta = (r: BoardRecord): BoardMeta => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})
const byNewest = (a: BoardMeta, b: BoardMeta) => b.createdAt - a.createdAt

// ---- Marking local changes --------------------------------------------------

let pushTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

export function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void flushNow(), delay)
}

function scheduleRetry(delay = RETRY_MS): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void flushNow(), delay)
}

export async function markBoardDirty(id: string, localUpdatedAt = Date.now()): Promise<void> {
  await updateSyncMeta((m) => {
    m.boards[id] = {
      serverUpdatedAt: m.boards[id]?.serverUpdatedAt ?? null,
      dirty: true,
      localUpdatedAt,
    }
    m.deletedBoards = m.deletedBoards.filter((x) => x !== id)
  })
  await refreshPending()
  if (status().state !== 'offline') status().set('saving')
  schedulePush()
}

export async function markBoardDeleted(id: string): Promise<void> {
  await updateSyncMeta((m) => {
    const wasOnServer = m.boards[id]?.serverUpdatedAt != null
    delete m.boards[id]
    // Never-pushed boards don't need a server delete.
    if (wasOnServer && !m.deletedBoards.includes(id)) m.deletedBoards.push(id)
  })
  await refreshPending()
  schedulePush(500)
}

export async function markLibraryDirty(ids: string[], localUpdatedAt = Date.now()): Promise<void> {
  if (ids.length === 0) return
  await updateSyncMeta((m) => {
    for (const id of ids) {
      m.library[id] = {
        serverUpdatedAt: m.library[id]?.serverUpdatedAt ?? null,
        dirty: true,
        localUpdatedAt,
      }
      m.deletedLibrary = m.deletedLibrary.filter((x) => x !== id)
    }
  })
  await refreshPending()
  if (status().state !== 'offline') status().set('saving')
  schedulePush()
}

export async function markLibraryDeleted(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await updateSyncMeta((m) => {
    for (const id of ids) {
      const wasOnServer = m.library[id]?.serverUpdatedAt != null
      delete m.library[id]
      if (wasOnServer && !m.deletedLibrary.includes(id)) m.deletedLibrary.push(id)
    }
  })
  await refreshPending()
  schedulePush(500)
}

// ---- Applying server data locally ------------------------------------------

async function writeBoardFromServer(sb: ServerBoard): Promise<void> {
  const existing = await loadLocalBoard(sb.id)
  const record: BoardRecord = {
    id: sb.id,
    name: sb.name,
    createdAt: existing?.createdAt ?? ms(sb.created_at),
    updatedAt: ms(sb.updated_at),
    snapshot: (sb.snapshot as TLEditorSnapshot | null) ?? null,
  }
  await saveLocalBoard(record)
  const index = await loadLocalBoardIndex()
  const meta = toBoardMeta(record)
  const next = index.some((b) => b.id === sb.id)
    ? index.map((b) => (b.id === sb.id ? meta : b))
    : [meta, ...index]
  await saveLocalBoardIndex(next.sort(byNewest))
  await updateSyncMeta((m) => {
    m.boards[sb.id] = { serverUpdatedAt: sb.updated_at, dirty: false, localUpdatedAt: record.updatedAt }
  })
}

async function removeLocalBoard(id: string): Promise<void> {
  await deleteLocalBoard(id)
  const index = await loadLocalBoardIndex()
  await saveLocalBoardIndex(index.filter((b) => b.id !== id))
  await updateSyncMeta((m) => {
    delete m.boards[id]
  })
}

// ---- Push -------------------------------------------------------------------

type PushOutcome = 'pushed' | 'server-won' | 'skipped'

async function pushBoard(id: string): Promise<PushOutcome> {
  const rec = await loadLocalBoard(id)
  const m0 = (await loadSyncMeta()).boards[id]
  if (!m0) return 'skipped'
  if (!rec) {
    await updateSyncMeta((m) => {
      delete m.boards[id]
    })
    return 'skipped'
  }

  const startedAt = m0.localUpdatedAt
  let expected = m0.serverUpdatedAt

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const saved =
        expected === null
          ? await createBoardOnServer({ id, name: rec.name, snapshot: rec.snapshot })
          : await updateBoardOnServer(id, {
              name: rec.name,
              snapshot: rec.snapshot,
              expected_updated_at: expected,
            })
      await updateSyncMeta((m) => {
        const cur = m.boards[id]
        if (!cur) return
        cur.serverUpdatedAt = saved.updated_at
        // Only clear `dirty` if nothing changed locally while we were pushing.
        if (cur.localUpdatedAt === startedAt) cur.dirty = false
      })
      return 'pushed'
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.status === 404 && expected !== null) {
        expected = null // deleted on the server; re-create (server revives the row)
        continue
      }
      let server: ServerBoard | null = null
      if (err.status === 409 && err.code === 'conflict') {
        server = (err.body as { server?: ServerBoard } | null)?.server ?? null
      } else if (err.status === 409 && err.code === 'exists') {
        server = await getBoard(id)
      }
      if (!server) throw err

      // Last-write-wins on updated_at.
      if (ms(server.updated_at) > rec.updatedAt) {
        await writeBoardFromServer(server)
        emitBoards({ changed: [id], removed: [] })
        return 'server-won'
      }
      expected = server.updated_at // local is newer: overwrite the server copy
    }
  }
  throw new ApiError(409, 'conflict', 'Could not resolve a sync conflict')
}

async function pushLibraryShape(id: string): Promise<void> {
  const shapes = await loadLocalLibrary()
  const shape = shapes.find((s) => s.id === id)
  const m0 = (await loadSyncMeta()).library[id]
  if (!m0) return
  if (!shape) {
    await updateSyncMeta((m) => {
      delete m.library[id]
    })
    return
  }

  const startedAt = m0.localUpdatedAt
  const payload = {
    name: shape.name,
    category: shape.category,
    content: shape.content,
    thumbnail: shape.thumbnail,
  }
  const create = () =>
    createLibraryShapeOnServer({ id, ...payload, created_at: new Date(shape.createdAt).toISOString() })
  const update = () => updateLibraryShapeOnServer(id, payload)

  let saved: ServerLibraryShape
  try {
    saved = m0.serverUpdatedAt === null ? await create() : await update()
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    if (err.status === 409 && err.code === 'exists') saved = await update()
    else if (err.status === 404) saved = await create()
    else throw err
  }
  await updateSyncMeta((m) => {
    const cur = m.library[id]
    if (!cur) return
    cur.serverUpdatedAt = saved.updated_at
    if (cur.localUpdatedAt === startedAt) cur.dirty = false
  })
}

async function runFlush(): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer)
  const meta = await loadSyncMeta()
  if (pendingCount(meta) === 0) {
    status().setPending(0)
    if (status().state === 'saving') status().set('saved')
    return
  }

  status().set('saving')
  let serverWon = false
  try {
    for (const id of [...meta.deletedBoards]) {
      try {
        await deleteBoardOnServer(id)
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err
      }
      await updateSyncMeta((m) => {
        m.deletedBoards = m.deletedBoards.filter((x) => x !== id)
      })
    }
    for (const id of [...meta.deletedLibrary]) {
      try {
        await deleteLibraryShapeOnServer(id)
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err
      }
      await updateSyncMeta((m) => {
        m.deletedLibrary = m.deletedLibrary.filter((x) => x !== id)
      })
    }

    const dirtyBoards = Object.entries((await loadSyncMeta()).boards)
      .filter(([, v]) => v.dirty)
      .map(([id]) => id)
    for (const id of dirtyBoards) {
      if ((await pushBoard(id)) === 'server-won') serverWon = true
    }

    const dirtyShapes = Object.entries((await loadSyncMeta()).library)
      .filter(([, v]) => v.dirty)
      .map(([id]) => id)
    for (const id of dirtyShapes) await pushLibraryShape(id)
  } catch (err) {
    await refreshPending()
    if (isOfflineError(err)) {
      status().set('offline')
      scheduleRetry()
    } else {
      status().set('error', err instanceof Error ? err.message : 'Sync failed')
      scheduleRetry(RETRY_MS * 4)
    }
    return
  }

  const left = await refreshPending()
  if (left > 0) {
    // New edits arrived while we were pushing.
    schedulePush()
    return
  }
  if (serverWon) {
    status().set('conflict', 'Another device saved newer changes; they replaced your copy.')
  } else {
    status().set('saved')
  }
}

let flushing: Promise<void> | null = null
let flushAgain = false

/** Push all pending changes now (also what the debounce timer and 'online' event call). */
export function flushNow(): Promise<void> {
  if (flushing) {
    flushAgain = true
    return flushing
  }
  flushing = exclusive(runFlush).finally(() => {
    flushing = null
    if (flushAgain) {
      flushAgain = false
      void flushNow()
    }
  })
  return flushing
}

// ---- Pull / reconcile -------------------------------------------------------

function emitBoards(change: RemoteBoardChange): void {
  if (change.changed.length === 0 && change.removed.length === 0) return
  for (const cb of boardListeners) cb(change)
}

/** @returns false when the server could not be reached. */
async function reconcileBoardsInner(): Promise<boolean> {
  let serverBoards
  try {
    serverBoards = await listBoards()
  } catch (err) {
    if (isOfflineError(err)) return false
    throw err
  }

  const meta = await loadSyncMeta()
  const index = await loadLocalBoardIndex()
  const localById = new Map(index.map((b) => [b.id, b]))
  const serverIds = new Set(serverBoards.map((b) => b.id))
  const changed: string[] = []
  const removed: string[] = []
  const toFetch: string[] = []

  for (const sb of serverBoards) {
    if (meta.deletedBoards.includes(sb.id)) continue // pending local delete wins
    const local = localById.get(sb.id)
    const lm = meta.boards[sb.id]

    if (!local) {
      toFetch.push(sb.id)
    } else if (!lm) {
      // Same id on both sides but no sync history (e.g. cleared metadata): newest wins.
      if (ms(sb.updated_at) > local.updatedAt) toFetch.push(sb.id)
      else
        await updateSyncMeta((m) => {
          m.boards[sb.id] = { serverUpdatedAt: sb.updated_at, dirty: true, localUpdatedAt: local.updatedAt }
        })
    } else if (lm.dirty) {
      // Unpushed local edits. Newer server copy wins; otherwise the push overwrites it.
      if (ms(sb.updated_at) > lm.localUpdatedAt && sb.updated_at !== lm.serverUpdatedAt) toFetch.push(sb.id)
    } else if (sb.updated_at !== lm.serverUpdatedAt) {
      toFetch.push(sb.id)
    }
  }

  for (const id of toFetch) {
    const full = await getBoard(id)
    await writeBoardFromServer(full)
    changed.push(id)
  }

  for (const local of index) {
    if (serverIds.has(local.id)) continue
    const lm = meta.boards[local.id]
    if (!lm) continue // legacy local-only board: kept (offered for import)
    if (lm.serverUpdatedAt !== null && !lm.dirty) {
      // It was synced before and is gone from the server: deleted on another device.
      await removeLocalBoard(local.id)
      removed.push(local.id)
    }
    // else: never pushed or edited since - the next flush creates it on the server.
  }

  emitBoards({ changed, removed })
  return true
}

async function reconcileLibraryInner(): Promise<boolean> {
  let serverShapes: ServerLibraryShape[]
  try {
    serverShapes = await listLibraryOnServer()
  } catch (err) {
    if (isOfflineError(err)) return false
    throw err
  }

  const meta = await loadSyncMeta()
  const local = await loadLocalLibrary()
  const localById = new Map(local.map((s) => [s.id, s]))
  const serverIds = new Set(serverShapes.map((s) => s.id))
  const next: LibraryShape[] = []
  let changed = false

  const fromServer = (s: ServerLibraryShape): LibraryShape => ({
    id: s.id,
    name: s.name,
    category: s.category,
    content: s.content as LibraryShape['content'],
    thumbnail: s.thumbnail,
    createdAt: ms(s.created_at),
  })

  for (const s of serverShapes) {
    if (meta.deletedLibrary.includes(s.id)) continue
    const l = localById.get(s.id)
    const lm = meta.library[s.id]
    const takeServer =
      !l ||
      (lm
        ? lm.dirty
          ? ms(s.updated_at) > lm.localUpdatedAt && s.updated_at !== lm.serverUpdatedAt
          : s.updated_at !== lm.serverUpdatedAt
        : true)
    if (takeServer) {
      next.push(fromServer(s))
      changed = true
      await updateSyncMeta((m) => {
        m.library[s.id] = { serverUpdatedAt: s.updated_at, dirty: false, localUpdatedAt: ms(s.updated_at) }
      })
    } else if (l) {
      next.push(l)
    }
  }

  for (const l of local) {
    if (serverIds.has(l.id)) continue
    const lm = meta.library[l.id]
    if (lm && lm.serverUpdatedAt !== null && !lm.dirty) {
      changed = true // deleted on another device
      await updateSyncMeta((m) => {
        delete m.library[l.id]
      })
      continue
    }
    next.push(l) // legacy / never pushed / dirty: keep
  }

  if (changed) {
    next.sort((a, b) => b.createdAt - a.createdAt)
    await saveLocalLibrary(next)
    for (const cb of libraryListeners) cb()
  }
  return true
}

export async function detectLegacy(): Promise<LegacyCounts | null> {
  const meta = await loadSyncMeta()
  if (meta.legacyDismissed) return null
  const boards = (await loadLocalBoardIndex()).filter((b) => !meta.boards[b.id]).length
  const shapes = (await loadLocalLibrary()).filter((s) => !meta.library[s.id]).length
  return boards + shapes > 0 ? { boards, shapes } : null
}

/**
 * Pull server state into IndexedDB. Resolves to false when offline.
 * Safe to call often; never overlaps with a push.
 */
export function reconcileAll(): Promise<boolean> {
  return exclusive(async () => {
    try {
      const boardsOk = await reconcileBoardsInner()
      const libraryOk = boardsOk ? await reconcileLibraryInner() : false
      if (!boardsOk || !libraryOk) {
        if (status().state !== 'conflict') status().set('offline')
        await refreshPending()
        return false
      }
      status().setLegacy(await detectLegacy())
      const pending = await refreshPending()
      if (pending > 0) {
        if (status().state === 'offline' || status().state === 'idle') schedulePush(0) // back online: flush the queue
      } else if (status().state === 'offline' || status().state === 'idle') {
        status().set('saved')
      }
      return true
    } catch (err) {
      status().set('error', err instanceof Error ? err.message : 'Sync failed')
      return false
    }
  })
}

/** Reconcile with a deadline, used on first run so a slow server can't block startup. */
export async function reconcileWithTimeout(timeoutMs: number): Promise<boolean> {
  return Promise.race([
    reconcileAll(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ])
}

// ---- One-time import of pre-sync local data ---------------------------------

export async function importLegacyLocalData(): Promise<void> {
  const meta = await loadSyncMeta()
  const boards = (await loadLocalBoardIndex()).filter((b) => !meta.boards[b.id])
  const shapes = (await loadLocalLibrary()).filter((s) => !meta.library[s.id])
  await updateSyncMeta((m) => {
    for (const b of boards) {
      m.boards[b.id] = { serverUpdatedAt: null, dirty: true, localUpdatedAt: b.updatedAt }
    }
    for (const s of shapes) {
      m.library[s.id] = { serverUpdatedAt: null, dirty: true, localUpdatedAt: s.createdAt }
    }
    m.legacyDismissed = false
  })
  status().setLegacy(null)
  await refreshPending()
  await flushNow()
}

export async function dismissLegacyImport(): Promise<void> {
  await updateSyncMeta((m) => {
    m.legacyDismissed = true
  })
  status().setLegacy(null)
}

// ---- Lifecycle --------------------------------------------------------------

let started = false

/** Wire connectivity listeners once. `refresh` should pull + apply server state. */
export function startSync(refresh: () => Promise<void>): void {
  if (started || typeof window === 'undefined') return
  started = true

  let lastFocusRefresh = 0
  window.addEventListener('online', () => {
    void flushNow().then(refresh)
  })
  window.addEventListener('offline', () => status().set('offline'))
  window.addEventListener('focus', () => {
    const now = Date.now()
    if (now - lastFocusRefresh < FOCUS_RECONCILE_MS) return
    lastFocusRefresh = now
    if (status().state === 'saving') return // don't pull over in-flight edits
    void refresh()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNow()
  })
  if (!navigator.onLine) status().set('offline')
}
