/**
 * The one diagram pipeline: normalize → measure → ELK layout (worker) → real tldraw shapes +
 * bound elbow arrows → fit. Used by AI generation, Mermaid import, image-to-diagram, edit-selection
 * create/connect ops and "Tidy up". By default appends beside existing shapes; pass
 * `replacePrevious: true` to swap the prior AI diagram (e.g. turn-into-flowchart).
 */
import {
  Box,
  createShapeId,
  type Editor,
  type JsonObject,
  type TLShapeId,
} from 'tldraw'
import { useDiagramStyleStore } from '../../store/diagramStyleStore'
import type { DiagramStyle } from '../../lib/diagramTheme'
import { GROUP_SHAPE_TYPE, NODE_SHAPE_TYPE } from '../../shapes/diagramTypes'
import { listAiShapeIds } from '../extractGraph'
import type { DrawAiMeta, Graph } from '../types'
import { animateIn } from './animate'
import { createEdgeArrows, type EdgeInput } from './edges'
import { editorWidthFn, ensureDiagramFonts } from './editorMeasure'
import { getElk } from './elkClient'
import {
  FIT_PADDING,
  MAX_FIT_ZOOM,
  chooseLayout,
  type LayoutInput,
  type LayoutResult,
  type Rect,
} from './layout'
import { normalizeGraph, type NormalizedGraph } from './normalize'
import { measureEdgeLabel, measureGroupTitle, measureNode, type NodeSize } from './sizing'
import { GRID, snapLayout } from './snap'

export type MeasuredDiagram = {
  graph: NormalizedGraph
  sizes: Map<string, NodeSize>
  input: LayoutInput
}

/** Measure text and build the ELK input for a normalized graph. */
export function measureDiagram(editor: Editor, graph: NormalizedGraph, style: DiagramStyle): MeasuredDiagram {
  const width = editorWidthFn(editor, style)
  const sizes = new Map<string, NodeSize>()
  for (const n of graph.nodes) sizes.set(n.id, measureNode(n, width))
  const input: LayoutInput = {
    nodes: graph.nodes.map((n) => {
      const s = sizes.get(n.id)!
      return { id: n.id, w: s.w, h: s.h, group: n.group }
    }),
    edges: graph.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ? measureEdgeLabel(e.label, width) : undefined,
    })),
    groups: graph.groups.map((g) => ({ id: g.id, minW: measureGroupTitle(g.label.toUpperCase(), width) * 1.1 + 40 })),
  }
  return { graph, sizes, input }
}

export function viewportSize(editor: Editor) {
  const b = editor.getViewportScreenBounds()
  return { w: b.w, h: b.h }
}

export async function computeLayout(
  editor: Editor,
  measured: MeasuredDiagram,
  direction: 'LR' | 'TB' | 'auto',
): Promise<LayoutResult> {
  const raw = await chooseLayout(getElk(), measured.input, { direction, viewport: viewportSize(editor) })
  return snapLayout(raw, GRID)
}

const APPEND_GAP = GRID * 4

export type PlaceOptions = {
  style?: DiagramStyle
  /** Delete previously generated AI shapes first (default false — append). */
  replacePrevious?: boolean
  /** Fit the camera to the result (default true). */
  zoom?: boolean
}

export type PlaceResult = { shapeIds: TLShapeId[]; nodeShapeIds: Map<string, TLShapeId> }

/** Page-space offset so the layout lands at the intended center (or beside existing work). */
function placementOffset(
  editor: Editor,
  layoutBounds: Rect,
  replacePrevious: boolean,
  previousIds: TLShapeId[],
): { dx: number; dy: number } {
  if (replacePrevious) {
    const prevBounds = previousIds.length ? editor.getShapesPageBounds(previousIds) : null
    const center = prevBounds ?? editor.getViewportPageBounds()
    return {
      dx: Math.round((center.midX - (layoutBounds.x + layoutBounds.w / 2)) / GRID) * GRID,
      dy: Math.round((center.midY - (layoutBounds.y + layoutBounds.h / 2)) / GRID) * GRID,
    }
  }

  const existingIds = [...editor.getCurrentPageShapeIds()]
  const pageBounds = existingIds.length ? editor.getShapesPageBounds(existingIds) : null
  if (!pageBounds) {
    const center = editor.getViewportPageBounds()
    return {
      dx: Math.round((center.midX - (layoutBounds.x + layoutBounds.w / 2)) / GRID) * GRID,
      dy: Math.round((center.midY - (layoutBounds.y + layoutBounds.h / 2)) / GRID) * GRID,
    }
  }

  // Place to the right of existing content so generate / Mermaid don't overlap.
  return {
    dx: Math.round((pageBounds.maxX + APPEND_GAP - layoutBounds.x) / GRID) * GRID,
    dy: Math.round((pageBounds.y - layoutBounds.y) / GRID) * GRID,
  }
}

/** Place a full graph on the canvas (one undo step). */
export async function placeGraph(editor: Editor, graph: Graph, opts: PlaceOptions = {}): Promise<PlaceResult> {
  const style = opts.style ?? useDiagramStyleStore.getState().style
  const replacePrevious = opts.replacePrevious === true
  const norm = normalizeGraph(graph)
  if (norm.nodes.length === 0) return { shapeIds: [], nodeShapeIds: new Map() }

  await ensureDiagramFonts(style)
  const measured = measureDiagram(editor, norm, style)
  const layout = await computeLayout(editor, measured, norm.direction)

  const previous = replacePrevious ? listAiShapeIds(editor) : []
  const { dx, dy } = placementOffset(editor, layout.bounds, replacePrevious, previous)

  const result: PlaceResult = { shapeIds: [], nodeShapeIds: new Map() }
  const nodeMeta = (nodeId: string): JsonObject => ({
    drawai: { nodeId, graph } as unknown as JsonObject,
  })
  const marker: JsonObject = { drawai: {} }

  editor.run(() => {
    editor.markHistoryStoppingPoint('ai-diagram')
    if (previous.length > 0) editor.deleteShapes(previous)

    const groupShapeIds = new Map<string, TLShapeId>()
    for (const g of norm.groups) {
      const r = layout.groups[g.id]
      if (!r) continue
      const id = createShapeId()
      groupShapeIds.set(g.id, id)
      editor.createShape({
        id,
        type: GROUP_SHAPE_TYPE,
        x: r.x + dx,
        y: r.y + dy,
        meta: { drawai: { nodeId: g.id } as JsonObject },
        props: { label: g.label, tone: g.tone, w: r.w, h: r.h, look: style },
      })
      result.shapeIds.push(id)
    }

    for (const n of norm.nodes) {
      const r = layout.nodes[n.id]
      const size = measured.sizes.get(n.id)
      if (!r || !size) continue
      const id = createShapeId()
      result.nodeShapeIds.set(n.id, id)
      const parent = n.group ? groupShapeIds.get(n.group) : undefined
      const gr = n.group ? layout.groups[n.group] : undefined
      editor.createShape({
        id,
        type: NODE_SHAPE_TYPE,
        parentId: parent,
        x: parent && gr ? r.x - gr.x : r.x + dx,
        y: parent && gr ? r.y - gr.y : r.y + dy,
        meta: nodeMeta(n.id),
        props: {
          shape: size.shape,
          tone: n.tone,
          label: n.label,
          description: n.description ?? '',
          icon: n.icon ?? '',
          w: r.w,
          h: r.h,
          look: style,
        },
      })
      result.shapeIds.push(id)
    }

    const edgeInputs: EdgeInput[] = []
    for (const e of norm.edges) {
      const from = result.nodeShapeIds.get(e.from)
      const to = result.nodeShapeIds.get(e.to)
      if (!from || !to) continue
      const hint = layout.edges[e.id]?.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      edgeInputs.push({ id: e.id, from, to, label: e.label, kind: e.kind, hint })
    }
    const arrows = createEdgeArrows(editor, edgeInputs, {
      direction: layout.direction,
      look: style,
      meta: marker,
    })
    result.shapeIds.push(...arrows)
  })

  if (opts.zoom !== false) {
    const b = layout.bounds
    editor.zoomToBounds(new Box(b.x + dx, b.y + dy, b.w, b.h), {
      inset: FIT_PADDING,
      targetZoom: MAX_FIT_ZOOM,
      animation: { duration: 260 },
    })
  }
  animateIn(editor, [...result.shapeIds])
  return result
}

export type { DrawAiMeta, Rect }
