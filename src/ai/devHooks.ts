import type { Editor } from 'tldraw'
import { placeGraph } from './diagram/pipeline'
import { tidySelection } from './diagram/tidy'
import type { Graph } from './types'

/** Dev-only console helpers for iterating on diagram rendering (not bundled in production). */
export function installDevHooks(editor: Editor) {
  if (!import.meta.env.DEV) return
  ;(window as unknown as Record<string, unknown>).__drawai = {
    editor,
    place: (graph: Graph) => placeGraph(editor, graph),
    tidy: () => tidySelection(editor),
    /** PNG data URL of the whole page (uses the SVG export path). */
    snap: async (scale = 1) => {
      const ids = [...editor.getCurrentPageShapeIds()]
      const { blob } = await editor.toImage(ids, { format: 'png', background: true, padding: 32, scale })
      return await new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.readAsDataURL(blob)
      })
    },
  }
}
