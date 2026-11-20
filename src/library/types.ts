import type { TLContent } from 'tldraw'

export type LibraryShape = {
  id: string
  name: string
  category: string
  content: TLContent
  thumbnail: string
  createdAt: number
}

export type LibraryExportFile = {
  version: 1
  shapes: LibraryShape[]
}

export const LIBRARY_DRAG_MIME = 'application/x-drawai-library-shape'
