/**
 * Raw IndexedDB access (the offline cache). The server is the source of truth;
 * `persistence.ts` / `library/persistence.ts` wrap these and trigger background sync.
 */
import { del, get, set } from 'idb-keyval'
import type { LibraryShape } from '../library/types'
import type { BoardMeta, BoardRecord } from './types'

const INDEX_KEY = 'drawai:boards-index'
const LIBRARY_KEY = 'drawai:shape-library'
const META_KEY = 'drawai:sync-meta'
const boardKey = (id: string) => `drawai:board:${id}`

export const loadLocalBoardIndex = async (): Promise<BoardMeta[]> =>
  (await get<BoardMeta[]>(INDEX_KEY)) ?? []
export const saveLocalBoardIndex = (index: BoardMeta[]) => set(INDEX_KEY, index)

export const loadLocalBoard = async (id: string): Promise<BoardRecord | null> =>
  (await get<BoardRecord>(boardKey(id))) ?? null
export const saveLocalBoard = (record: BoardRecord) => set(boardKey(record.id), record)
export const deleteLocalBoard = (id: string) => del(boardKey(id))

export const loadLocalLibrary = async (): Promise<LibraryShape[]> =>
  (await get<LibraryShape[]>(LIBRARY_KEY)) ?? []
export const saveLocalLibrary = (shapes: LibraryShape[]) => set(LIBRARY_KEY, shapes)

// ---- Sync metadata ----------------------------------------------------------

export type ItemSyncMeta = {
  /** Exact `updated_at` string the server last returned for this item (null = never pushed). */
  serverUpdatedAt: string | null
  /** Local changes not yet pushed. */
  dirty: boolean
  /** Client clock (ms) of the last local change, used for last-write-wins. */
  localUpdatedAt: number
}

export type SyncMeta = {
  boards: Record<string, ItemSyncMeta>
  library: Record<string, ItemSyncMeta>
  /** Deletions waiting to be sent to the server. */
  deletedBoards: string[]
  deletedLibrary: string[]
  /** User chose "Not now" on the legacy-import banner. */
  legacyDismissed: boolean
}

const emptyMeta = (): SyncMeta => ({
  boards: {},
  library: {},
  deletedBoards: [],
  deletedLibrary: [],
  legacyDismissed: false,
})

let metaCache: SyncMeta | null = null
let chain: Promise<unknown> = Promise.resolve()

async function readMeta(): Promise<SyncMeta> {
  if (!metaCache) metaCache = { ...emptyMeta(), ...((await get<SyncMeta>(META_KEY)) ?? {}) }
  return metaCache
}

export const loadSyncMeta = readMeta

/** Serialized read-modify-write so concurrent callers never clobber each other. */
export function updateSyncMeta<T = void>(fn: (meta: SyncMeta) => T): Promise<T> {
  const run = chain.then(async () => {
    const meta = await readMeta()
    const result = fn(meta)
    await set(META_KEY, meta)
    return result
  })
  chain = run.catch(() => undefined)
  return run
}
