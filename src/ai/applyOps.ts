import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { getPreset } from '../library/presets'
import { isPresetKind } from '../library/presetKinds'
import { ICON_SHAPE_TYPE } from '../shapes/iconTypes'
import { NODE_SHAPE_TYPE } from '../shapes/diagramTypes'
import { useDiagramStyleStore } from '../store/diagramStyleStore'
import { createEdgeArrows, type EdgeInput } from './diagram/edges'
import { ensureDiagramFonts, measureNodeInEditor } from './diagram/editorMeasure'
import { normalizeGraph } from './diagram/normalize'
import { GRID } from './diagram/snap'
import type { RenderShape } from './diagram/sizing'
import type { EdgeKind, EditOp } from './types'

type Rect = { x: number; y: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect, margin: number) =>
  a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y

/** Nearest grid-aligned position to `want` that does not collide with existing shapes. */
function findFreeSpot(editor: Editor, want: Rect, taken: Rect[]): { x: number; y: number } {
  const others: Rect[] = [...taken]
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id)
    if (!shape || shape.type === 'arrow' || shape.type === 'dgroup') continue
    const b = editor.getShapePageBounds(id)
    if (b) others.push({ x: b.x, y: b.y, w: b.w, h: b.h })
  }
  const snap = (v: number) => Math.round(v / GRID) * GRID
  const base = { x: snap(want.x), y: snap(want.y) }
  const free = (p: { x: number; y: number }) =>
    !others.some((o) => overlaps({ x: p.x, y: p.y, w: want.w, h: want.h }, o, 24))
  if (free(base)) return base
  const step = GRID * 3
  for (let ring = 1; ring <= 24; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const p = { x: base.x + dx * step, y: base.y + dy * step }
        if (free(p)) return p
      }
    }
  }
  return base
}

/** Resolve LLM create-op fields into a fully specified diagram node. */
function resolveNode(op: Extract<EditOp, { op: 'create' }>) {
  const g = normalizeGraph({
    direction: 'auto',
    nodes: [
      { id: 'n', label: op.label || getPreset(op.kind)?.label || op.kind, kind: op.kind, shape: op.shape, tone: op.tone, description: op.description },
    ],
    edges: [],
  })
  return g.nodes[0]!
}

/**
 * Apply validated patch ops in one history mark so Undo / bailToMark reverts everything.
 * Only touches the shapes named by the ops: the rest of the board is never re-laid out.
 * Returns the mark id for Reject (bailToMark).
 */
export function applyEditOps(editor: Editor, ops: EditOp[]): string {
  const mark = editor.markHistoryStoppingPoint('ai-edit-selection')
  const idMap = new Map<string, TLShapeId>()
  const style = useDiagramStyleStore.getState().style
  void ensureDiagramFonts(style)
  const placed: Rect[] = []
  const edges: EdgeInput[] = []

  editor.run(() => {
    for (const op of ops) {
      if (op.op !== 'create') continue
      const shapeId = createShapeId()
      idMap.set(op.tempId, shapeId)
      const node = resolveNode(op)
      const size = measureNodeInEditor(
        editor,
        { label: node.label, description: node.description, icon: node.icon, shape: node.shape },
        style,
      )
      const spot = findFreeSpot(editor, { x: op.x, y: op.y, w: size.w, h: size.h }, placed)
      placed.push({ x: spot.x, y: spot.y, w: size.w, h: size.h })
      editor.createShape({
        id: shapeId,
        type: NODE_SHAPE_TYPE,
        x: spot.x,
        y: spot.y,
        props: {
          shape: size.shape,
          tone: node.tone,
          label: node.label,
          description: node.description ?? '',
          icon: node.icon ?? '',
          w: size.w,
          h: size.h,
          look: style,
        },
      })
    }

    for (const op of ops) {
      if (op.op === 'update') {
        const shape = editor.getShape(op.id as TLShapeId)
        if (!shape || shape.isLocked) continue
        const patch: Record<string, unknown> = { id: shape.id, type: shape.type }
        if (typeof op.x === 'number') patch.x = op.x
        if (typeof op.y === 'number') patch.y = op.y
        const pr = op.props
        if (shape.type === NODE_SHAPE_TYPE) {
          const p = shape.props as {
            label: string
            description: string
            icon: string
            shape: string
            tone: string
            look: 'clean' | 'sketch'
            w: number
            h: number
          }
          const next = { ...p }
          if (pr) {
            if (pr.label != null) next.label = pr.label
            if (pr.description != null) next.description = pr.description
            if (pr.tone != null && ['neutral', 'primary', 'success', 'warning', 'danger', 'info'].includes(pr.tone)) next.tone = pr.tone
            if (pr.shape != null) {
              const g = normalizeGraph({
                direction: 'auto',
                nodes: [{ id: 'n', label: next.label, kind: pr.kind ?? 'process', shape: pr.shape }],
                edges: [],
              }).nodes[0]!
              next.shape = g.shape
              if (pr.kind == null) next.icon = ''
            }
            if (pr.kind != null && isPresetKind(pr.kind)) {
              const g = normalizeGraph({
                direction: 'auto',
                nodes: [{ id: 'n', label: next.label, kind: pr.kind, shape: pr.shape }],
                edges: [],
              }).nodes[0]!
              next.icon = g.icon ?? ''
              if (pr.shape == null) next.shape = g.shape
            }
          }
          const contentChanged =
            !!pr && (pr.label != null || pr.description != null || pr.kind != null || pr.shape != null)
          let w = p.w
          let h = p.h
          let shapeName = next.shape
          if (contentChanged) {
            const size = measureNodeInEditor(
              editor,
              { label: next.label, description: next.description || undefined, icon: next.icon || undefined, shape: next.shape as RenderShape },
              next.look,
            )
            w = size.w
            h = size.h
            shapeName = size.shape
          }
          if (typeof pr?.w === 'number') w = pr.w
          if (typeof pr?.h === 'number') h = pr.h
          const baseX = typeof op.x === 'number' ? op.x : shape.x
          const baseY = typeof op.y === 'number' ? op.y : shape.y
          // Re-fit around the centre so neighbours keep their spacing.
          patch.x = baseX + (p.w - w) / 2
          patch.y = baseY + (p.h - h) / 2
          patch.props = {
            label: next.label,
            description: next.description,
            icon: next.icon,
            shape: shapeName,
            tone: next.tone,
            w,
            h,
          }
        } else if (pr) {
          const props: Record<string, unknown> = {}
          if (pr.label != null) props.label = pr.label
          if (pr.kind != null && isPresetKind(pr.kind)) props.kind = pr.kind
          if (typeof pr.w === 'number') props.w = pr.w
          if (typeof pr.h === 'number') props.h = pr.h
          if (pr.color != null && shape.type === ICON_SHAPE_TYPE) props.color = pr.color
          if (Object.keys(props).length > 0) patch.props = props
        }
        editor.updateShape(patch as never)
      } else if (op.op === 'delete') {
        const shape = editor.getShape(op.id as TLShapeId)
        if (!shape || shape.isLocked) continue
        editor.deleteShapes([shape.id])
      } else if (op.op === 'connect') {
        const from = (idMap.get(op.fromId) ?? op.fromId) as TLShapeId
        const to = (idMap.get(op.toId) ?? op.toId) as TLShapeId
        if (!editor.getShape(from) || !editor.getShape(to)) continue
        const label = op.label?.trim() || undefined
        let kind: EdgeKind = 'default'
        if (op.kind && ['default', 'yes', 'no', 'error', 'async'].includes(op.kind)) kind = op.kind as EdgeKind
        else if (label) {
          const low = label.toLowerCase()
          if (low === 'yes') kind = 'yes'
          else if (low === 'no') kind = 'no'
        }
        edges.push({ id: `c${edges.length}`, from, to, label, kind })
      }
    }

    if (edges.length > 0) createEdgeArrows(editor, edges, { direction: 'auto', look: style })
  })

  return mark
}
