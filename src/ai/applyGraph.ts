import type { Editor } from 'tldraw'
import { placeGraph } from './diagram/pipeline'
import type { Graph } from './types'

/** Lay out and place a Graph on the canvas (one undo step). Shared by every diagram entry point. */
export async function applyGraphToEditor(editor: Editor, graph: Graph): Promise<void> {
  await placeGraph(editor, graph)
}
