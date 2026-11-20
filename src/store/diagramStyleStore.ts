import { create } from 'zustand'
import { DEFAULT_DIAGRAM_STYLE, type DiagramStyle } from '../lib/diagramTheme'

const KEY = 'drawai.diagramStyle'

function load(): DiagramStyle {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'clean' || v === 'sketch') return v
  } catch {
    /* ignore */
  }
  return DEFAULT_DIAGRAM_STYLE
}

type State = {
  style: DiagramStyle
  setStyle: (style: DiagramStyle) => void
}

/** Style applied to newly generated diagrams (Clean by default; Sketch = hand-drawn). */
export const useDiagramStyleStore = create<State>((set) => ({
  style: load(),
  setStyle: (style) => {
    try {
      localStorage.setItem(KEY, style)
    } catch {
      /* ignore */
    }
    set({ style })
  },
}))
