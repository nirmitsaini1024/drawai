/** "Tidy up": re-run the ELK layout locally (no LLM) for the selected diagram shapes. */
import { Box, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { GRID, snapLayout } from './snap'
import { useDiagramStyleStore } from '../../store/diagramStyleStore'
import { readEdgeMeta } from '../../shapes/DiagramArrowShapeUtil'
import { GROUP_SHAPE_TYPE, NODE_SHAPE_TYPE } from '../../shapes/diagramTypes'
import { allDiagramNodes, richTextPlain, selectedDiagramNodes } from '../extractGraph'
import type { EdgeKind } from '../types'
import { createEdgeArrows, type EdgeInput } from './edges'
import { editorWidthFn, ensureDiagramFonts } from './editorMeasure'
import { getElk } from './elkClient'
import { chooseLayout, FIT_PADDING, MAX_FIT_ZOOM, type Dir, type LayoutInput } from './layout'
import { viewportSize } from './pipeline'
import { measureEdgeLabel, measureGroupTitle } from './sizing'
import type { DiagramStyle } from '../../lib/diagramTheme'

export type TidyResult = { ok: true } | { ok: false; error: string }

/** Infer LR vs TB from how edges currently flow so tidy does not flip the diagram. */
function inferDirection(
  editor: Editor,
  arrows: { from: TLShapeId; to: TLShapeId }[],
): Dir {
  let dxSum = 0
  let dySum = 0
  for (const a of arrows) {
    const s = editor.getShapePageBounds(a.from)
    const t = editor.getShapePageBounds(a.to)
    if (!s || !t) continue
    dxSum += Math.abs(t.midX - s.midX)
    dySum += Math.abs(t.midY - s.midY)
  }
  if (dxSum === 0 && dySum === 0) return 'TB'
  return dySum >= dxSum ? 'TB' : 'LR'
}

export async function tidySelection(editor: Editor): Promise<TidyResult> {
  const selected = selectedDiagramNodes(editor)
  const nodes: TLShape[] = selected.length > 0 ? selected : allDiagramNodes(editor)
  if (nodes.length === 0) return { ok: false, error: 'Select diagram shapes to tidy up (or generate a diagram first)' }
  const nodeSet = new Set(nodes.map((n) => n.id))

  const firstLook = (nodes.find((n) => n.type === NODE_SHAPE_TYPE)?.props as { look?: DiagramStyle } | undefined)?.look
  const style = firstLook ?? useDiagramStyleStore.getState().style
  await ensureDiagramFonts(style)
  const width = editorWidthFn(editor, style)

  // Groups: only treat a container as a compound node when all its children are being tidied.
  const groupShapes = new Map<TLShapeId, TLShape>()
  for (const n of nodes) {
    const parent = n.parentId ? editor.getShape(n.parentId as TLShapeId) : undefined
    if (parent?.type !== GROUP_SHAPE_TYPE) continue
    const kids = editor.getSortedChildIdsForParent(parent.id)
    if (kids.every((k) => nodeSet.has(k) || editor.getShape(k)?.type === 'arrow')) groupShapes.set(parent.id, parent)
  }

  const groupOf = (n: TLShape): TLShapeId | undefined =>
    n.parentId && groupShapes.has(n.parentId as TLShapeId) ? (n.parentId as TLShapeId) : undefined

  // Arrows between tidied nodes that we own (carry diagram edge meta).
  type ArrowInfo = { shape: TLShape; from: TLShapeId; to: TLShapeId; label: string; kind: EdgeKind }
  const arrows: ArrowInfo[] = []
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id)
    if (!shape || shape.type !== 'arrow' || !readEdgeMeta(shape.meta)) continue
    let from: TLShapeId | undefined
    let to: TLShapeId | undefined
    for (const b of editor.getBindingsFromShape(shape, 'arrow')) {
      const t = (b.props as { terminal?: string }).terminal
      if (t === 'start') from = b.toId
      if (t === 'end') to = b.toId
    }
    if (!from || !to || !nodeSet.has(from) || !nodeSet.has(to)) continue
    arrows.push({
      shape,
      from,
      to,
      label: richTextPlain((shape.props as { richText?: unknown }).richText),
      kind: (readEdgeMeta(shape.meta)?.kind ?? 'default') as EdgeKind,
    })
  }

  const input: LayoutInput = {
    nodes: nodes.map((n) => {
      const p = n.props as { w: number; h: number }
      return { id: n.id, w: p.w, h: p.h, group: groupOf(n) }
    }),
    edges: arrows.map((a) => ({
      id: a.shape.id,
      from: a.from,
      to: a.to,
      kind: a.kind,
      label: a.label ? measureEdgeLabel(a.label, width) : undefined,
    })),
    groups: [...groupShapes.values()].map((g) => ({
      id: g.id,
      minW: measureGroupTitle((g.props as { label: string }).label.toUpperCase(), width) * 1.1 + 40,
    })),
  }

  const before = editor.getShapesPageBounds([...nodes.map((n) => n.id), ...groupShapes.keys()])
  // Keep the current flow direction and never wrap/compress to the viewport — that was shoving
  // side-branch nodes off-screen so they looked deleted.
  const direction = inferDirection(editor, arrows)
  const raw = await chooseLayout(getElk(), input, {
    direction,
    viewport: viewportSize(editor),
    compact: false,
  })
  const layout = snapLayout(raw, GRID)
  const cxLayout = layout.bounds.x + layout.bounds.w / 2
  const cyLayout = layout.bounds.y + layout.bounds.h / 2
  const dx = before ? Math.round((before.midX - cxLayout) / GRID) * GRID : 0
  const dy = before ? Math.round((before.midY - cyLayout) / GRID) * GRID : 0

  editor.run(() => {
    editor.markHistoryStoppingPoint('tidy-up')

    for (const g of groupShapes.values()) {
      const r = layout.groups[g.id]
      if (!r) continue
      editor.updateShape({
        id: g.id,
        type: GROUP_SHAPE_TYPE,
        x: r.x + dx,
        y: r.y + dy,
        props: { w: r.w, h: r.h },
      } as never)
    }

    for (const n of nodes) {
      const r = layout.nodes[n.id]
      if (!r || n.isLocked) continue
      const g = groupOf(n)
      let x: number
      let y: number
      if (g) {
        const gr = layout.groups[g]
        if (!gr) continue
        x = r.x - gr.x
        y = r.y - gr.y
      } else {
        const p = editor.getPointInParentSpace(n.id, { x: r.x + dx, y: r.y + dy })
        x = p.x
        y = p.y
      }
      editor.updateShape({ id: n.id, type: n.type, x, y } as never)
    }

    // Recreate our own arrows so sides / anchors / label positions are recomputed.
    const edgeInputs: EdgeInput[] = arrows.map((a) => ({
      id: a.shape.id,
      from: a.from,
      to: a.to,
      label: a.label || undefined,
      kind: a.kind,
      hint: layout.edges[a.shape.id]?.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    }))
    const meta = arrows[0]?.shape.meta
    editor.deleteShapes(arrows.map((a) => a.shape.id))
    createEdgeArrows(editor, edgeInputs, {
      direction: layout.direction,
      look: style,
      meta: meta && 'drawai' in meta ? { drawai: meta.drawai } : undefined,
    })
  })

  const afterIds = [...nodes.map((n) => n.id), ...groupShapes.keys()]
  const after = editor.getShapesPageBounds(afterIds)
  if (after) {
    editor.zoomToBounds(new Box(after.x, after.y, after.w, after.h), {
      inset: FIT_PADDING,
      targetZoom: MAX_FIT_ZOOM,
      animation: { duration: 220 },
    })
  }
  return { ok: true }
}
