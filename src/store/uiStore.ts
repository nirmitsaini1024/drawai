import { create } from 'zustand'

type UiState = {
  commandPaletteOpen: boolean
  imageDialogOpen: boolean
  mermaidDialogOpen: boolean
  explainDialogOpen: boolean
  explainText: string
  explainTitle: string
  shareDialogOpen: boolean
  openCommandPalette: () => void
  closeCommandPalette: () => void
  toggleCommandPalette: () => void
  openImageDialog: () => void
  closeImageDialog: () => void
  openMermaidDialog: () => void
  closeMermaidDialog: () => void
  openExplainDialog: (title: string, text: string) => void
  closeExplainDialog: () => void
  openShareDialog: () => void
  closeShareDialog: () => void
}

export const useUiStore = create<UiState>((set) => ({
  commandPaletteOpen: false,
  imageDialogOpen: false,
  mermaidDialogOpen: false,
  explainDialogOpen: false,
  explainText: '',
  explainTitle: 'Explanation',
  shareDialogOpen: false,

  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

  openImageDialog: () => set({ imageDialogOpen: true }),
  closeImageDialog: () => set({ imageDialogOpen: false }),

  openMermaidDialog: () => set({ mermaidDialogOpen: true }),
  closeMermaidDialog: () => set({ mermaidDialogOpen: false }),

  openExplainDialog: (title, text) =>
    set({ explainDialogOpen: true, explainTitle: title, explainText: text }),
  closeExplainDialog: () => set({ explainDialogOpen: false }),

  openShareDialog: () => set({ shareDialogOpen: true }),
  closeShareDialog: () => set({ shareDialogOpen: false }),
}))
