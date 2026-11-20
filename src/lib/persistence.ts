/**
 * Boards + settings persistence.
 *
 * Reads/writes hit IndexedDB first (instant, works offline). Board changes are then
 * queued for the API by the sync layer (`sync.ts`); the server is the source of truth.
 * Public signatures are unchanged from the IndexedDB-only version.
 */
import { get, set } from 'idb-keyval'
import type { TLEditorSnapshot } from 'tldraw'
import {
  deleteLocalBoard,
  loadLocalBoard,
  loadLocalBoardIndex,
  saveLocalBoard,
  saveLocalBoardIndex,
} from './localDb'
import { markBoardDeleted, markBoardDirty, reconcileWithTimeout } from './sync'
import {
  DEFAULT_GRID_SETTINGS,
  type AppSettings,
  type BoardMeta,
  type BoardRecord,
  type GridStyle,
  type ThemeMode,
} from './types'

const SETTINGS_KEY = 'drawai:settings'

/** How long a first-run browser waits for the server before starting empty. */
const FIRST_RUN_SERVER_WAIT_MS = 2500

function normalizeSettings(
  raw: Partial<AppSettings> | null | undefined,
  fallback: { activeBoardId: string; theme: ThemeMode },
): AppSettings {
  const gridStyle = raw?.gridStyle
  const style: GridStyle =
    gridStyle === 'lines' || gridStyle === 'dots' || gridStyle === 'none'
      ? gridStyle
      : DEFAULT_GRID_SETTINGS.gridStyle

  return {
    activeBoardId: raw?.activeBoardId ?? fallback.activeBoardId,
    theme: raw?.theme ?? fallback.theme,
    showGrid: raw?.showGrid ?? DEFAULT_GRID_SETTINGS.showGrid,
    snapToGrid: raw?.snapToGrid ?? DEFAULT_GRID_SETTINGS.snapToGrid,
    gridStyle: style,
  }
}

function createId(): string {
  return crypto.randomUUID()
}

function createBoardMeta(name: string): BoardMeta {
  const now = Date.now()
  return {
    id: createId(),
    name,
    createdAt: now,
    updatedAt: now,
  }
}

export async function loadSettings(): Promise<AppSettings | null> {
  return (await get<AppSettings>(SETTINGS_KEY)) ?? null
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await set(SETTINGS_KEY, settings)
}

export const loadBoardIndex = loadLocalBoardIndex
const saveBoardIndex = saveLocalBoardIndex
export const loadBoard = loadLocalBoard

export async function saveBoardSnapshot(
  id: string,
  snapshot: TLEditorSnapshot,
  name?: string,
): Promise<BoardMeta | null> {
  const existing = await loadBoard(id)
  if (!existing) return null

  const updated: BoardRecord = {
    ...existing,
    name: name ?? existing.name,
    updatedAt: Date.now(),
    snapshot,
  }
  await saveLocalBoard(updated)

  const index = await loadBoardIndex()
  const nextIndex = index.map((b) =>
    b.id === id
      ? { id: updated.id, name: updated.name, createdAt: updated.createdAt, updatedAt: updated.updatedAt }
      : b,
  )
  await saveBoardIndex(nextIndex)
  await markBoardDirty(id, updated.updatedAt)
  return {
    id: updated.id,
    name: updated.name,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}

export async function renameBoard(id: string, name: string): Promise<BoardMeta | null> {
  const existing = await loadBoard(id)
  if (!existing) return null

  const trimmed = name.trim() || 'Untitled'
  const updated: BoardRecord = {
    ...existing,
    name: trimmed,
    updatedAt: Date.now(),
  }
  await saveLocalBoard(updated)

  const index = await loadBoardIndex()
  const nextIndex = index.map((b) =>
    b.id === id
      ? { id: updated.id, name: updated.name, createdAt: updated.createdAt, updatedAt: updated.updatedAt }
      : b,
  )
  await saveBoardIndex(nextIndex)
  await markBoardDirty(id, updated.updatedAt)
  return {
    id: updated.id,
    name: updated.name,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}

export async function createBoard(name = 'Untitled'): Promise<BoardRecord> {
  const meta = createBoardMeta(name)
  const record: BoardRecord = { ...meta, snapshot: null }
  await saveLocalBoard(record)
  const index = await loadBoardIndex()
  await saveBoardIndex([meta, ...index])
  await markBoardDirty(meta.id, meta.updatedAt)
  return record
}

export async function deleteBoard(id: string): Promise<void> {
  await deleteLocalBoard(id)
  const index = await loadBoardIndex()
  await saveBoardIndex(index.filter((b) => b.id !== id))
  await markBoardDeleted(id)
}

/**
 * Bootstrap from the local cache (instant) and return the active state.
 * A brand-new browser briefly asks the server for existing boards first, so it
 * doesn't create a stray empty board next to ones that already exist remotely.
 */
export async function bootstrapPersistence(defaultTheme: ThemeMode = 'light'): Promise<{
  boards: BoardMeta[]
  activeBoardId: string
  theme: ThemeMode
  showGrid: boolean
  snapToGrid: boolean
  gridStyle: GridStyle
  activeSnapshot: TLEditorSnapshot | null
}> {
  let boards = await loadBoardIndex()
  let settings = await loadSettings()

  if (boards.length === 0) {
    await reconcileWithTimeout(FIRST_RUN_SERVER_WAIT_MS)
    boards = await loadBoardIndex()
  }

  if (boards.length === 0) {
    const first = await createBoard('Untitled')
    boards = [first]
    settings = normalizeSettings(settings, {
      activeBoardId: first.id,
      theme: settings?.theme ?? defaultTheme,
    })
    await saveSettings(settings)
  }

  const activeBoardId =
    settings?.activeBoardId && boards.some((b) => b.id === settings.activeBoardId)
      ? settings.activeBoardId
      : boards[0].id

  const theme = settings?.theme ?? defaultTheme
  const normalized = normalizeSettings(settings, { activeBoardId, theme })
  if (
    !settings ||
    settings.activeBoardId !== normalized.activeBoardId ||
    settings.theme !== normalized.theme ||
    settings.showGrid !== normalized.showGrid ||
    settings.snapToGrid !== normalized.snapToGrid ||
    settings.gridStyle !== normalized.gridStyle
  ) {
    await saveSettings(normalized)
  }

  const active = await loadBoard(normalized.activeBoardId)

  return {
    boards,
    activeBoardId: normalized.activeBoardId,
    theme: normalized.theme,
    showGrid: normalized.showGrid,
    snapToGrid: normalized.snapToGrid,
    gridStyle: normalized.gridStyle,
    activeSnapshot: active?.snapshot ?? null,
  }
}
