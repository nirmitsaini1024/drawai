import { createTLStore, getSnapshot, loadSnapshot, type Editor, type TLEditorSnapshot } from 'tldraw'
import { create } from 'zustand'
import { applyGridPreferences } from '../lib/gridPrefs'
import {
  bootstrapPersistence,
  createBoard,
  deleteBoard,
  loadBoard,
  loadBoardIndex,
  renameBoard,
  saveBoardSnapshot,
  saveSettings,
} from '../lib/persistence'
import {
  onRemoteBoardChange,
  reconcileAll,
  startSync,
  type RemoteBoardChange,
} from '../lib/sync'
import {
  DEFAULT_GRID_SETTINGS,
  type AppSettings,
  type BoardMeta,
  type GridStyle,
  type ThemeMode,
} from '../lib/types'

type AppState = {
  ready: boolean
  editor: Editor | null
  boards: BoardMeta[]
  activeBoardId: string
  theme: ThemeMode
  showGrid: boolean
  snapToGrid: boolean
  gridStyle: GridStyle
  boardsDrawerOpen: boolean
  initialSnapshot: TLEditorSnapshot | null
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  /** True while we load a snapshot into the editor ourselves (so autosave ignores it). */
  quietLoad: boolean

  hydrate: () => Promise<void>
  refreshFromServer: () => Promise<void>
  setEditor: (editor: Editor | null) => void
  setTheme: (theme: ThemeMode) => Promise<void>
  setShowGrid: (show: boolean) => Promise<void>
  setSnapToGrid: (snap: boolean) => Promise<void>
  setGridStyle: (style: GridStyle) => Promise<void>
  toggleShowGrid: () => Promise<void>
  toggleSnapToGrid: () => Promise<void>
  setBoardsDrawerOpen: (open: boolean) => void
  toggleBoardsDrawer: () => void
  setSaveStatus: (status: AppState['saveStatus']) => void

  getActiveBoard: () => BoardMeta | undefined
  renameActiveBoard: (name: string) => Promise<void>
  persistCurrentBoard: () => Promise<void>
  openBoard: (id: string) => Promise<void>
  addBoard: (name?: string) => Promise<void>
  removeBoard: (id: string) => Promise<void>
}

function freshSnapshot(): TLEditorSnapshot {
  return getSnapshot(createTLStore())
}

/** Serialized document last written per board, so unchanged boards aren't re-saved/re-pushed. */
const lastDoc = new Map<string, string>()
const docSig = (snapshot: TLEditorSnapshot | null | undefined) =>
  JSON.stringify(snapshot?.document ?? null)

function settingsFrom(state: {
  activeBoardId: string
  theme: ThemeMode
  showGrid: boolean
  snapToGrid: boolean
  gridStyle: GridStyle
}): AppSettings {
  return {
    activeBoardId: state.activeBoardId,
    theme: state.theme,
    showGrid: state.showGrid,
    snapToGrid: state.snapToGrid,
    gridStyle: state.gridStyle,
  }
}

function syncEditorGrid(editor: Editor | null, showGrid: boolean, snapToGrid: boolean) {
  if (!editor) return
  applyGridPreferences(editor, { showGrid, snapToGrid })
}

export const useAppStore = create<AppState>((set, get) => {
  /** Load a snapshot into the editor without triggering autosave. */
  function quietLoad(editor: Editor, boardId: string, snapshot: TLEditorSnapshot | null, overwriteSession: boolean) {
    set({ quietLoad: true })
    try {
      loadSnapshot(editor.store, snapshot ?? freshSnapshot(), {
        forceOverwriteSessionState: overwriteSession,
      })
      const { theme, showGrid, snapToGrid } = get()
      editor.user.updateUserPreferences({ colorScheme: theme })
      syncEditorGrid(editor, showGrid, snapToGrid)
      lastDoc.set(boardId, docSig(editor.getSnapshot()))
    } finally {
      setTimeout(() => set({ quietLoad: false }), 50)
    }
  }

  async function persistSettings(patch: Partial<AppSettings>) {
    const next = { ...settingsFrom(get()), ...patch }
    await saveSettings(next)
  }

  async function handleRemoteChange(change: RemoteBoardChange) {
    const boards = await loadBoardIndex()
    set({ boards })
    const { activeBoardId, editor } = get()

    if (change.removed.includes(activeBoardId)) {
      // Active board was deleted on another device: switch without re-saving it.
      const next = boards[0]
      if (next) {
        const record = await loadBoard(next.id)
        if (editor) quietLoad(editor, next.id, record?.snapshot ?? null, true)
        await persistSettings({ activeBoardId: next.id })
        set({ activeBoardId: next.id, initialSnapshot: record?.snapshot ?? null })
      } else {
        await get().addBoard()
      }
      return
    }

    if (change.changed.includes(activeBoardId)) {
      const record = await loadBoard(activeBoardId)
      if (!record) return
      if (editor) quietLoad(editor, activeBoardId, record.snapshot, false)
      else set({ initialSnapshot: record.snapshot })
    }
  }

  return {
    ready: false,
    editor: null,
    boards: [],
    activeBoardId: '',
    theme: 'light',
    showGrid: DEFAULT_GRID_SETTINGS.showGrid,
    snapToGrid: DEFAULT_GRID_SETTINGS.snapToGrid,
    gridStyle: DEFAULT_GRID_SETTINGS.gridStyle,
    boardsDrawerOpen: false,
    initialSnapshot: null,
    saveStatus: 'idle',
    quietLoad: false,

    hydrate: async () => {
      const prefersDark =
        typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      const boot = await bootstrapPersistence(prefersDark ? 'dark' : 'light')
      document.documentElement.classList.toggle('dark', boot.theme === 'dark')
      lastDoc.set(boot.activeBoardId, docSig(boot.activeSnapshot))
      set({
        ready: true,
        boards: boot.boards,
        activeBoardId: boot.activeBoardId,
        theme: boot.theme,
        showGrid: boot.showGrid,
        snapToGrid: boot.snapToGrid,
        gridStyle: boot.gridStyle,
        initialSnapshot: boot.activeSnapshot,
      })

      // Local copy is on screen; now pull server state in the background.
      onRemoteBoardChange((c) => void handleRemoteChange(c))
      startSync(() => get().refreshFromServer())
      void get().refreshFromServer()
    },

    refreshFromServer: async () => {
      await reconcileAll()
    },

    setEditor: (editor) => {
      set({ editor })
      if (editor) {
        const { showGrid, snapToGrid } = get()
        syncEditorGrid(editor, showGrid, snapToGrid)
      }
    },

    setTheme: async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      const { editor } = get()
      editor?.user.updateUserPreferences({ colorScheme: theme })
      await persistSettings({ theme })
      set({ theme })
    },

    setShowGrid: async (showGrid) => {
      const { editor, snapToGrid } = get()
      syncEditorGrid(editor, showGrid, snapToGrid)
      await persistSettings({ showGrid })
      set({ showGrid })
    },

    setSnapToGrid: async (snapToGrid) => {
      const { editor, showGrid } = get()
      syncEditorGrid(editor, showGrid, snapToGrid)
      await persistSettings({ snapToGrid })
      set({ snapToGrid })
    },

    setGridStyle: async (gridStyle) => {
      await persistSettings({ gridStyle })
      set({ gridStyle })
      // Ensure grid layer is mounted when switching away from none while show is on.
      const { editor, showGrid, snapToGrid } = get()
      syncEditorGrid(editor, showGrid, snapToGrid)
    },

    toggleShowGrid: async () => {
      await get().setShowGrid(!get().showGrid)
    },

    toggleSnapToGrid: async () => {
      await get().setSnapToGrid(!get().snapToGrid)
    },

    setBoardsDrawerOpen: (open) => set({ boardsDrawerOpen: open }),
    toggleBoardsDrawer: () => set((s) => ({ boardsDrawerOpen: !s.boardsDrawerOpen })),
    setSaveStatus: (saveStatus) => set({ saveStatus }),

    getActiveBoard: () => {
      const { boards, activeBoardId } = get()
      return boards.find((b) => b.id === activeBoardId)
    },

    renameActiveBoard: async (name) => {
      const { activeBoardId } = get()
      const updated = await renameBoard(activeBoardId, name)
      if (!updated) return
      set((s) => ({
        boards: s.boards.map((b) => (b.id === updated.id ? updated : b)),
      }))
    },

    persistCurrentBoard: async () => {
      const { editor, activeBoardId, getActiveBoard } = get()
      if (!editor || !activeBoardId) return

      const snapshot = editor.getSnapshot()
      const sig = docSig(snapshot)
      if (lastDoc.get(activeBoardId) === sig) {
        set({ saveStatus: 'saved' }) // nothing changed since the last save
        return
      }

      set({ saveStatus: 'saving' })
      try {
        const meta = await saveBoardSnapshot(activeBoardId, snapshot, getActiveBoard()?.name)
        if (meta) {
          lastDoc.set(activeBoardId, sig)
          set((s) => ({
            boards: s.boards.map((b) => (b.id === meta.id ? meta : b)),
            saveStatus: 'saved',
          }))
        } else {
          set({ saveStatus: 'error' })
        }
      } catch {
        set({ saveStatus: 'error' })
      }
    },

    openBoard: async (id) => {
      const { editor, activeBoardId, persistCurrentBoard } = get()
      if (id === activeBoardId) {
        set({ boardsDrawerOpen: false })
        return
      }
      await persistCurrentBoard()
      const record = await loadBoard(id)
      if (!record || !editor) return

      quietLoad(editor, id, record.snapshot, true)

      await persistSettings({ activeBoardId: id })
      set({ activeBoardId: id, boardsDrawerOpen: false, saveStatus: 'saved' })
    },

    addBoard: async (name = 'Untitled') => {
      const { editor, persistCurrentBoard } = get()
      await persistCurrentBoard()
      const record = await createBoard(name)
      if (editor) quietLoad(editor, record.id, null, true)
      await persistSettings({ activeBoardId: record.id })
      set((s) => ({
        boards: [record, ...s.boards],
        activeBoardId: record.id,
        boardsDrawerOpen: true,
        saveStatus: 'saved',
      }))
    },

    removeBoard: async (id) => {
      const { boards, activeBoardId, editor, persistCurrentBoard } = get()
      if (boards.length <= 1) return

      const nextBoards = boards.filter((b) => b.id !== id)
      const nextId = nextBoards[0]?.id
      if (!nextId) return

      if (id === activeBoardId) {
        // Switch the editor to another board first, then delete the old one
        // (deleting first would let a pending autosave resurrect it).
        if (editor) {
          const record = await loadBoard(nextId)
          quietLoad(editor, nextId, record?.snapshot ?? null, true)
        }
        await deleteBoard(id)
        await persistSettings({ activeBoardId: nextId })
        set({ boards: nextBoards, activeBoardId: nextId, saveStatus: 'saved' })
      } else {
        await persistCurrentBoard()
        await deleteBoard(id)
        await persistSettings({ activeBoardId })
        set({ boards: nextBoards })
      }
    },
  }
})
