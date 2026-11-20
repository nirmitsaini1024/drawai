import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { ICON_SHAPE_TYPE } from '../shapes/iconTypes'
import { GROUP_SHAPE_TYPE, NODE_SHAPE_TYPE } from '../shapes/diagramTypes'
import { readEdgeMeta } from '../shapes/DiagramArrowShapeUtil'
import type { DrawAiMeta, Graph, GraphEdge, GraphGroup, GraphNode } from './types'

export function readMeta(shape: TLShape): DrawAiMeta | null {
  const raw = shape.meta?.drawai
  if (!raw || typeof raw !== 'object') return null
  return raw as DrawAiMeta
}

export function isNodeShape(shape: TLShape | undefined): boolean {
  return !!shape && (shape.type === ICON_SHAPE_TYPE || shape.type === NODE_SHAPE_TYPE)
}

export function findStoredGraph(editor: Editor): Graph | null {
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id)
    if (!shape) continue
    const meta = readMeta(shape)
    if (meta?.graph) return meta.graph
  }
  return null
}

export function richTextPlain(richText: unknown): string {
  const parts: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as { text?: unknown; content?: unknown }
    if (typeof o.text === 'string') parts.push(o.text)
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(richText)
  return parts.join('').trim()
}

const KIND_FOR_SHAPE: Record<string, string> = {
  terminator: 'start-end',
  decision: 'decision',
  hexagon: 'decision',
  io: 'input-output',
  data: 'database',
  person: 'person',
  document: 'document',
  process: 'process',
  service: 'server',
}

/** Selected diagram nodes, plus the children of any selected group container. */
export function selectedDiagramNodes(editor: Editor): TLShape[] {
  const out = new Map<TLShapeId, TLShape>()
  for (const s of editor.getSelectedShapes()) {
    if (isNodeShape(s)) out.set(s.id, s)
    else if (s.type === GROUP_SHAPE_TYPE) {
      for (const id of editor.getSortedChildIdsForParent(s.id)) {
        const c = editor.getShape(id)
        if (isNodeShape(c)) out.set(c!.id, c!)
      }
    }
  }
  return [...out.values()]
}

export function allDiagramNodes(editor: Editor): TLShape[] {
  return editor
    .getCurrentPageShapes()
    .filter((s) => s.type === NODE_SHAPE_TYPE || (s.type === ICON_SHAPE_TYPE && readMeta(s)))
}

/** Build a Graph from existing diagram shapes (and the arrows between them). */
export function graphFromShapes(editor: Editor, nodes: TLShape[], direction?: Graph['direction']): Graph {
  const idByShape = new Map<TLShapeId, string>()
  const gNodes: GraphNode[] = []
  const gGroups = new Map<string, GraphGroup>()

  for (const shape of nodes) {
    const meta = readMeta(shape)
    const nodeId = meta?.nodeId ?? shape.id
    idByShape.set(shape.id, nodeId)
    if (shape.type === NODE_SHAPE_TYPE) {
      const p = shape.props as {
        label: string
        shape: string
        tone: string
        icon: string
        description: string
      }
      let group: string | undefined
      const parent = shape.parentId ? editor.getShape(shape.parentId as TLShapeId) : undefined
      if (parent?.type === GROUP_SHAPE_TYPE) {
        const gid = readMeta(parent)?.nodeId ?? parent.id
        group = gid
        if (!gGroups.has(gid)) {
          const gp = parent.props as { label: string; tone: string }
          gGroups.set(gid, { id: gid, label: gp.label, tone: gp.tone })
        }
      }
      gNodes.push({
        id: nodeId,
        label: p.label || nodeId,
        kind: p.icon || KIND_FOR_SHAPE[p.shape] || 'process',
        shape: p.shape === 'hexagon' ? 'decision' : p.shape,
        tone: p.tone,
        description: p.description || undefined,
        group,
      })
    } else {
      const p = shape.props as { kind: string; label: string }
      gNodes.push({ id: nodeId, label: p.label || nodeId, kind: p.kind || 'rect' })
    }
  }

  const shapeIds = new Set(nodes.map((s) => s.id))
  const edges: GraphEdge[] = []
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id)
    if (!shape || shape.type !== 'arrow') continue
    let fromShape: TLShapeId | undefined
    let toShape: TLShapeId | undefined
    for (const b of editor.getBindingsFromShape(shape, 'arrow')) {
      const terminal = (b.props as { terminal?: string }).terminal
      if (terminal === 'start') fromShape = b.toId
      if (terminal === 'end') toShape = b.toId
    }
    if (!fromShape || !toShape || !shapeIds.has(fromShape) || !shapeIds.has(toShape)) continue
    const from = idByShape.get(fromShape)
    const to = idByShape.get(toShape)
    if (!from || !to) continue
    const label = richTextPlain((shape.props as { richText?: unknown }).richText)
    const kind = readEdgeMeta(shape.meta)?.kind
    edges.push({ from, to, ...(label ? { label } : {}), ...(kind ? { kind } : {}) })
  }

  const stored = nodes.map(readMeta).find((m) => m?.graph)?.graph
  return {
    direction: direction ?? stored?.direction ?? 'auto',
    nodes: gNodes,
    edges,
    groups: [...gGroups.values()],
  }
}

/** Graph of the selected diagram shapes, or the stored graph when nothing is selected. */
export function extractCurrentGraph(editor: Editor): Graph | null {
  const nodes = selectedDiagramNodes(editor)
  if (nodes.length > 0) return graphFromShapes(editor, nodes)
  return findStoredGraph(editor)
}

export function listAiShapeIds(editor: Editor): TLShapeId[] {
  const ids: TLShapeId[] = []
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id)
    if (!shape) continue
    if (readMeta(shape)) ids.push(id)
  }
  return ids
}
