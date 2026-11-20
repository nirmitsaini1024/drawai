import { create } from 'zustand'
import { loadLibraryShapes, saveLibraryShapes } from '../library/persistence'
import { onRemoteLibraryChange } from '../lib/sync'
import type { LibraryExportFile, LibraryShape } from '../library/types'

type LibraryState = {
  ready: boolean
  shapes: LibraryShape[]
  panelOpen: boolean
  search: string
  categoryFilter: string
  saveDialogOpen: boolean

  hydrate: () => Promise<void>
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setSearch: (search: string) => void
  setCategoryFilter: (category: string) => void
  openSaveDialog: () => void
  closeSaveDialog: () => void

  addShape: (input: Omit<LibraryShape, 'id' | 'createdAt'>) => Promise<LibraryShape>
  renameShape: (id: string, name: string) => Promise<void>
  updateCategory: (id: string, category: string) => Promise<void>
  deleteShape: (id: string) => Promise<void>
  exportLibrary: () => LibraryExportFile
  importLibrary: (file: LibraryExportFile, mode: 'merge' | 'replace') => Promise<void>
  categories: () => string[]
  filteredShapes: () => LibraryShape[]
}

let unsubscribeRemote: (() => void) | null = null

async function persist(shapes: LibraryShape[]) {
  await saveLibraryShapes(shapes)
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  ready: false,
  shapes: [],
  panelOpen: false,
  search: '',
  categoryFilter: 'all',
  saveDialogOpen: false,

  hydrate: async () => {
    const shapes = await loadLibraryShapes()
    set({ shapes, ready: true })
    // The sync layer updates IndexedDB when other devices change the library.
    if (!unsubscribeRemote) {
      unsubscribeRemote = onRemoteLibraryChange(() => {
        void loadLibraryShapes().then((fresh) => set({ shapes: fresh }))
      })
    }
  },

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setSearch: (search) => set({ search }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  openSaveDialog: () => set({ saveDialogOpen: true }),
  closeSaveDialog: () => set({ saveDialogOpen: false }),

  addShape: async (input) => {
    const shape: LibraryShape = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    const shapes = [shape, ...get().shapes]
    await persist(shapes)
    set({ shapes, saveDialogOpen: false, panelOpen: true })
    return shape
  },

  renameShape: async (id, name) => {
    const trimmed = name.trim() || 'Untitled shape'
    const shapes = get().shapes.map((s) => (s.id === id ? { ...s, name: trimmed } : s))
    await persist(shapes)
    set({ shapes })
  },

  updateCategory: async (id, category) => {
    const trimmed = category.trim() || 'General'
    const shapes = get().shapes.map((s) => (s.id === id ? { ...s, category: trimmed } : s))
    await persist(shapes)
    set({ shapes })
  },

  deleteShape: async (id) => {
    const shapes = get().shapes.filter((s) => s.id !== id)
    await persist(shapes)
    set({ shapes })
  },

  exportLibrary: () => ({
    version: 1 as const,
    shapes: get().shapes,
  }),

  importLibrary: async (file, mode) => {
    const incoming = Array.isArray(file.shapes) ? file.shapes : []
    const normalized = incoming
      .filter(
        (s): s is LibraryShape =>
          !!s &&
          typeof s === 'object' &&
          typeof s.name === 'string' &&
          typeof s.category === 'string' &&
          !!s.content &&
          typeof s.thumbnail === 'string',
      )
      .map((s) => ({
        ...s,
        id: typeof s.id === 'string' ? s.id : crypto.randomUUID(),
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      }))

    let shapes: LibraryShape[]
    if (mode === 'replace') {
      shapes = normalized
    } else {
      const existingIds = new Set(get().shapes.map((s) => s.id))
      const merged = normalized.map((s) =>
        existingIds.has(s.id) ? { ...s, id: crypto.randomUUID() } : s,
      )
      shapes = [...merged, ...get().shapes]
    }
    await persist(shapes)
    set({ shapes, panelOpen: true })
  },

  categories: () => {
    const setCats = new Set(get().shapes.map((s) => s.category).filter(Boolean))
    return [...setCats].sort((a, b) => a.localeCompare(b))
  },

  filteredShapes: () => {
    const { shapes, search, categoryFilter } = get()
    const q = search.trim().toLowerCase()
    return shapes.filter((s) => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
      if (!q) return true
      return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    })
  },
}))
