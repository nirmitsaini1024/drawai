import type { Editor, JsonObject, TLArrowShape, TLShape } from 'tldraw'
import type { DiagramStyle } from '../../lib/diagramTheme'
import { readEdgeMeta } from '../../shapes/DiagramArrowShapeUtil'
import { GROUP_SHAPE_TYPE, NODE_SHAPE_TYPE } from '../../shapes/diagramTypes'
import { measureNodeInEditor } from './editorMeasure'
import type { RenderShape } from './sizing'

/**
 * Switch diagram shapes between Clean and Sketch. Applies to the selection (including children of
 * selected groups) or, with nothing selected, every diagram shape on the page. One undo step.
 * Returns the number of shapes changed.
 */
export function applyDiagramStyle(editor: Editor, style: DiagramStyle): number {
  const selected = editor.getSelectedShapes()
  let targets: TLShape[]
  if (selected.length > 0) {
    const set = new Map<string, TLShape>()
    const add = (s: TLShape) => set.set(s.id, s)
    for (const s of selected) {
      add(s)
      for (const id of editor.getSortedChildIdsForParent(s.id)) {
        const c = editor.getShape(id)
        if (c) add(c)
      }
    }
    // Arrows between restyled nodes follow along.
    const nodeIds = new Set([...set.values()].filter((s) => s.type === NODE_SHAPE_TYPE).map((s) => s.id))
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type !== 'arrow' || !readEdgeMeta(s.meta)) continue
      const ends = editor.getBindingsFromShape(s, 'arrow').map((b) => b.toId)
      if (ends.length > 0 && ends.every((e) => nodeIds.has(e))) add(s)
    }
    targets = [...set.values()]
  } else {
    targets = editor.getCurrentPageShapes()
  }

  let count = 0
  editor.run(() => {
    editor.markHistoryStoppingPoint('diagram-style')
    for (const s of targets) {
      if (s.isLocked) continue
      if (s.type === NODE_SHAPE_TYPE) {
        const p = s.props as {
          look: string
          label: string
          description: string
          icon: string
          shape: string
          w: number
          h: number
        }
        if (p.look === style) continue
        const size = measureNodeInEditor(
          editor,
          { label: p.label, description: p.description || undefined, icon: p.icon || undefined, shape: p.shape as RenderShape },
          style,
        )
        // Keep the card centred; never shrink below what the user sized it to.
        const w = Math.max(size.w, p.w)
        const h = Math.max(size.h, p.h)
        editor.updateShape({
          id: s.id,
          type: s.type,
          x: s.x + p.w / 2 - w / 2,
          y: s.y + p.h / 2 - h / 2,
          props: { look: style, w, h },
        } as never)
        count++
      } else if (s.type === GROUP_SHAPE_TYPE) {
        if ((s.props as { look: string }).look === style) continue
        editor.updateShape({ id: s.id, type: s.type, props: { look: style } } as never)
        count++
      } else if (s.type === 'arrow') {
        const meta = readEdgeMeta(s.meta)
        if (!meta || meta.look === style) continue
        editor.updateShape<TLArrowShape>({
          id: s.id,
          type: 'arrow',
          meta: { ...s.meta, dgEdge: { ...meta, look: style } } as JsonObject,
          props: {
            font: style === 'sketch' ? 'draw' : 'sans',
            dash: meta.kind === 'async' ? 'dashed' : style === 'sketch' ? 'draw' : 'solid',
          },
        })
        count++
      }
    }
  })
  return count
}
