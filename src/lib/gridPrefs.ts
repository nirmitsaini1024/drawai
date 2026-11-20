import type { Editor } from 'tldraw'
import { GRID_BASE_MINOR } from './grid'

/** Sync tldraw instance/document grid flags with DrawAI preferences. */
export function applyGridPreferences(
  editor: Editor,
  prefs: { showGrid: boolean; snapToGrid: boolean },
): void {
  // tldraw mounts `components.Grid` and enables shape snap when isGridMode is true.
  const isGridMode = prefs.showGrid || prefs.snapToGrid
  if (editor.getInstanceState().isGridMode !== isGridMode) {
    editor.updateInstanceState({ isGridMode })
  }
  if (editor.getDocumentSettings().gridSize !== GRID_BASE_MINOR) {
    editor.updateDocumentSettings({ gridSize: GRID_BASE_MINOR })
  }
}
