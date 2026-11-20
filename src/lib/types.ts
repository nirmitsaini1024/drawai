import type { TLEditorSnapshot } from 'tldraw'

export type ThemeMode = 'light' | 'dark'

export type GridStyle = 'lines' | 'dots' | 'none'

export type BoardMeta = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type BoardRecord = BoardMeta & {
  snapshot: TLEditorSnapshot | null
}

export type AppSettings = {
  activeBoardId: string
  theme: ThemeMode
  showGrid: boolean
  snapToGrid: boolean
  gridStyle: GridStyle
}

export const DEFAULT_GRID_SETTINGS = {
  showGrid: true,
  snapToGrid: true,
  gridStyle: 'lines' as GridStyle,
}
