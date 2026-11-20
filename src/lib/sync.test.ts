import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerBoard } from './api'

// ---- In-memory IndexedDB (idb-keyval) -----------------------------------------
const idb = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => void idb.set(k, structuredClone(v)),
  del: async (k: string) => void idb.delete(k),
}))

// ---- Fake API server -----------------------------------------------------------
type FakeBoard = ServerBoard & { deleted: boolean }
const server = {
  boards: new Map<string, FakeBoard>(),
  library: new Map<string, Record<string, unknown>>(),
  online: true,
  skew: 0, // ms added to the server clock (simulates another device saving "later")
  tick: 0,
  now() {
    return new Date(Date.now() + this.skew + ++this.tick).toISOString()
  },
  reset() {
    this.boards.clear()
    this.library.clear()
    this.online = true
    this.skew = 0
    this.tick = 0
  },
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  const { ApiError } = actual
  const guard = () => {
    if (!server.online) throw new ApiError(0, 'network', 'Server unreachable')
  }
  const strip = ({ deleted: _d, ...b }: FakeBoard): ServerBoard => b
  return {
    ...actual,
    listBoards: async () => {
      guard()
      return [...server.boards.values()]
        .filter((b) => !b.deleted)
        .map(({ snapshot: _s, deleted: _d, ...meta }) => meta)
    },
    getBoard: async (id: string) => {
      guard()
      const b = server.boards.get(id)
      if (!b || b.deleted) throw new ApiError(404, 'not_found', 'Board not found')
      return strip(b)
    },
    createBoardOnServer: async (body: { id: string; name: string; snapshot: unknown }) => {
      guard()
      const existing = server.boards.get(body.id)
      if (existing && !existing.deleted) throw new ApiError(409, 'exists', 'exists')
      const t = server.now()
      const board: FakeBoard = {
        id: body.id,
        name: body.name,
        snapshot: body.snapshot,
        created_at: t,
        updated_at: t,
        deleted: false,
      }
      server.boards.set(body.id, board)
      return strip(board)
    },
    updateBoardOnServer: async (
      id: string,
      body: { name?: string; snapshot?: unknown; expected_updated_at?: string | null },
    ) => {
      guard()
      const b = server.boards.get(id)
      if (!b || b.deleted) throw new ApiError(404, 'not_found', 'Board not found')
      if (body.expected_updated_at && body.expected_updated_at !== b.updated_at) {
        throw new ApiError(409, 'conflict', 'conflict', { server: strip(b) })
      }
      if (body.name !== undefined) b.name = body.name
      if (body.snapshot !== undefined) b.snapshot = body.snapshot
      b.updated_at = server.now()
      return strip(b)
    },
    deleteBoardOnServer: async (id: string) => {
      guard()
      const b = server.boards.get(id)
      if (!b || b.deleted) throw new ApiError(404, 'not_found', 'Board not found')
      b.deleted = true
    },
    listLibraryOnServer: async () => {
      guard()
      return [...server.library.values()]
    },
    createLibraryShapeOnServer: async (body: Record<string, unknown>) => {
      guard()
      const row = { ...body, updated_at: server.now() }
      server.library.set(body.id as string, row)
      return row
    },
    updateLibraryShapeOnServer: async (id: string, body: Record<string, unknown>) => {
      guard()
      const row = server.library.get(id)
      if (!row) throw new ApiError(404, 'not_found', 'nf')
      Object.assign(row, body, { updated_at: server.now() })
      return row
    },
    deleteLibraryShapeOnServer: async (id: string) => {
      guard()
      server.library.delete(id)
    },
  }
})

// ---- Helpers ---------------------------------------------------------------------
const snap = (label: string) => ({ document: { store: { label }, schema: {} }, session: {} })

async function load() {
  vi.resetModules()
  const sync = await import('./sync')
  const local = await import('./localDb')
  const status = (await import('./syncStatus')).useSyncStatus
  const persistence = await import('./persistence')
  return { sync, local, status, persistence }
}

beforeEach(() => {
  idb.clear()
  server.reset()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sync engine', () => {
  it('queues offline edits and flushes them when the server is back', async () => {
    const { sync, status, persistence } = await load()
    server.online = false

    const board = await persistence.createBoard('Offline board')
    await persistence.saveBoardSnapshot(board.id, snap('v1') as never)
    await sync.flushNow()

    expect(status.getState().state).toBe('offline')
    expect(status.getState().pending).toBe(1)
    expect(server.boards.size).toBe(0)

    server.online = true
    await sync.flushNow()

    expect(status.getState().state).toBe('saved')
    expect(status.getState().pending).toBe(0)
    const remote = server.boards.get(board.id)
    expect(remote?.name).toBe('Offline board')
    expect((remote?.snapshot as { document: { store: { label: string } } }).document.store.label).toBe('v1')
  })

  it('pushes later edits with expected_updated_at and keeps the server timestamp', async () => {
    const { sync, local, persistence } = await load()
    const board = await persistence.createBoard('A')
    await sync.flushNow()
    const first = (await local.loadSyncMeta()).boards[board.id]!.serverUpdatedAt
    expect(first).toBeTruthy()

    await persistence.saveBoardSnapshot(board.id, snap('v2') as never)
    await sync.flushNow()
    const second = (await local.loadSyncMeta()).boards[board.id]!.serverUpdatedAt
    expect(second).not.toBe(first)
    expect(server.boards.get(board.id)?.updated_at).toBe(second)
    expect((await local.loadSyncMeta()).boards[board.id]!.dirty).toBe(false)
  })

  it('conflict: a newer local edit overwrites the server copy (last-write-wins)', async () => {
    const { sync, status, persistence } = await load()
    const board = await persistence.createBoard('Shared')
    await sync.flushNow()

    // Another device saved at an older clock than our upcoming edit.
    const remote = server.boards.get(board.id)!
    remote.name = 'Other device'
    remote.updated_at = new Date(Date.now() - 60_000).toISOString()

    await persistence.renameBoard(board.id, 'Mine')
    await sync.flushNow()

    expect(server.boards.get(board.id)?.name).toBe('Mine')
    expect(status.getState().state).toBe('saved')
  })

  it('conflict: a newer server copy replaces local edits and flags a conflict', async () => {
    const { sync, status, local, persistence } = await load()
    const board = await persistence.createBoard('Shared')
    await sync.flushNow()

    const changes: unknown[] = []
    sync.onRemoteBoardChange((c) => changes.push(c))

    await persistence.renameBoard(board.id, 'Stale local edit')
    // Meanwhile another device saved *after* our edit.
    const remote = server.boards.get(board.id)!
    remote.name = 'Newer on server'
    remote.updated_at = new Date(Date.now() + 60_000).toISOString()

    await sync.flushNow()

    expect((await local.loadLocalBoard(board.id))?.name).toBe('Newer on server')
    expect(server.boards.get(board.id)?.name).toBe('Newer on server')
    expect(status.getState().state).toBe('conflict')
    expect(changes).toEqual([{ changed: [board.id], removed: [] }])
  })

  it('reconcile pulls new server boards and removes boards deleted on another device', async () => {
    const { sync, local, persistence } = await load()
    const keep = await persistence.createBoard('Keep')
    const doomed = await persistence.createBoard('Doomed')
    await sync.flushNow()

    // Another device: adds a board, deletes "Doomed".
    server.boards.set('remote-1', {
      id: 'remote-1',
      name: 'From elsewhere',
      snapshot: snap('r') as never,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    })
    server.boards.get(doomed.id)!.deleted = true

    const changes: Array<{ changed: string[]; removed: string[] }> = []
    sync.onRemoteBoardChange((c) => changes.push(c))
    expect(await sync.reconcileAll()).toBe(true)

    const ids = (await local.loadLocalBoardIndex()).map((b) => b.id)
    expect(ids).toContain(keep.id)
    expect(ids).toContain('remote-1')
    expect(ids).not.toContain(doomed.id)
    expect(changes[0]).toEqual({ changed: ['remote-1'], removed: [doomed.id] })
  })

  it('queues deletes made offline and sends them later', async () => {
    const { sync, persistence } = await load()
    const board = await persistence.createBoard('Temp')
    await sync.flushNow()
    expect(server.boards.get(board.id)?.deleted).toBe(false)

    server.online = false
    await persistence.deleteBoard(board.id)
    await sync.flushNow()
    expect(server.boards.get(board.id)?.deleted).toBe(false)

    server.online = true
    await sync.flushNow()
    expect(server.boards.get(board.id)?.deleted).toBe(true)
  })

  it('does not push a board that was created and deleted before ever reaching the server', async () => {
    const { sync, local, persistence } = await load()
    server.online = false
    const board = await persistence.createBoard('Ephemeral')
    await persistence.deleteBoard(board.id)
    server.online = true
    await sync.flushNow()
    expect(server.boards.size).toBe(0)
    expect((await local.loadSyncMeta()).deletedBoards).toEqual([])
  })

  it('offers legacy local-only data for import and uploads it on request', async () => {
    const { sync, local, status } = await load()
    // Data from before server sync existed: records in IndexedDB with no sync metadata.
    const now = Date.now()
    await local.saveLocalBoard({ id: 'legacy-1', name: 'Old board', createdAt: now, updatedAt: now, snapshot: null })
    await local.saveLocalBoardIndex([{ id: 'legacy-1', name: 'Old board', createdAt: now, updatedAt: now }])
    await local.saveLocalLibrary([
      { id: 'lib-1', name: 'Old shape', category: 'General', content: {} as never, thumbnail: 't', createdAt: now },
    ])

    expect(await sync.reconcileAll()).toBe(true)
    expect(status.getState().legacy).toEqual({ boards: 1, shapes: 1 })
    expect(server.boards.size).toBe(0) // nothing uploaded without consent

    await sync.importLegacyLocalData()
    expect(server.boards.get('legacy-1')?.name).toBe('Old board')
    expect(server.library.has('lib-1')).toBe(true)
    expect(status.getState().legacy).toBeNull()
  })

  it('"Not now" hides the legacy banner without deleting local data', async () => {
    const { sync, local, status } = await load()
    const now = Date.now()
    await local.saveLocalBoard({ id: 'legacy-2', name: 'Keep me', createdAt: now, updatedAt: now, snapshot: null })
    await local.saveLocalBoardIndex([{ id: 'legacy-2', name: 'Keep me', createdAt: now, updatedAt: now }])
    await sync.reconcileAll()
    expect(status.getState().legacy).toEqual({ boards: 1, shapes: 0 })

    await sync.dismissLegacyImport()
    await sync.reconcileAll()
    expect(status.getState().legacy).toBeNull()
    expect((await local.loadLocalBoardIndex()).map((b) => b.id)).toEqual(['legacy-2'])
    expect(server.boards.size).toBe(0)
  })

  it('first run on a new browser adopts existing server boards instead of creating a blank one', async () => {
    const { persistence, local } = await load()
    server.boards.set('srv-1', {
      id: 'srv-1',
      name: 'Existing remote board',
      snapshot: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    })
    const boot = await persistence.bootstrapPersistence('light')
    expect(boot.boards.map((b) => b.id)).toEqual(['srv-1'])
    expect(boot.activeBoardId).toBe('srv-1')
    expect(await local.loadLocalBoardIndex()).toHaveLength(1)
  })

  it('library changes sync through saveLibraryShapes (create, edit, delete)', async () => {
    const { sync } = await load()
    const lib = await import('../library/persistence')
    const shape = { id: 's-1', name: 'One', category: 'General', content: {} as never, thumbnail: 't', createdAt: Date.now() }

    await lib.saveLibraryShapes([shape])
    await sync.flushNow()
    expect(server.library.get('s-1')?.name).toBe('One')

    await lib.saveLibraryShapes([{ ...shape, name: 'Renamed' }])
    await sync.flushNow()
    expect(server.library.get('s-1')?.name).toBe('Renamed')

    await lib.saveLibraryShapes([])
    await sync.flushNow()
    expect(server.library.has('s-1')).toBe(false)
  })
})
