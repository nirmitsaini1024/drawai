/**
 * ELK (layered) layout. Pure: takes an ELK instance (web-worker backed in the app, bundled in
 * tests), measured node sizes and edges, returns absolute positions + routed polylines.
 */
import type { ELK, ElkNode, ElkExtendedEdge, ElkPoint } from 'elkjs/lib/elk-api'
import { GROUP_METRICS } from '../../lib/diagramTheme'
import type { EdgeKind } from '../types'

export type Pt = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export type LayoutNodeIn = { id: string; w: number; h: number; group?: string }
export type LayoutEdgeIn = {
  id: string
  from: string
  to: string
  kind: EdgeKind
  label?: { w: number; h: number }
}
export type LayoutGroupIn = { id: string; minW: number }

export type LayoutInput = {
  nodes: LayoutNodeIn[]
  edges: LayoutEdgeIn[]
  groups: LayoutGroupIn[]
}

export type Dir = 'LR' | 'TB'

export type LayoutResult = {
  direction: Dir
  wrapped: boolean
  nodes: Record<string, Rect>
  groups: Record<string, Rect>
  edges: Record<string, { points: Pt[]; label?: Rect }>
  bounds: Rect
}

export const SPACING = { node: 48, layer: 72, edgeNode: 20, edgeEdge: 14 } as const

/** Escape hatch for tuning / tests. */
export const LAYOUT_OVERRIDES: Record<string, string> = {}

export function buildElkGraph(input: LayoutInput, dir: Dir, wrap: boolean): ElkNode {
  const groupIds = new Set(input.groups.map((g) => g.id))
  const hasGroups = groupIds.size > 0

  const toElkNode = (n: LayoutNodeIn): ElkNode => ({
    id: n.id,
    width: n.w,
    height: n.h,
    layoutOptions: { 'elk.portConstraints': 'FREE' },
  })

  // Children keep the order of first appearance (a group sits where its first member is) so that
  // ELK's model-order cycle breaking sees the same flow order as the input.
  const children: ElkNode[] = []
  const emittedGroups = new Set<string>()
  const groupById = new Map(input.groups.map((g) => [g.id, g]))
  for (const n of input.nodes) {
    const g = n.group && groupById.get(n.group)
    if (!g) {
      children.push(toElkNode(n))
      continue
    }
    if (emittedGroups.has(g.id)) continue
    emittedGroups.add(g.id)
    children.push({
      id: g.id,
      children: input.nodes.filter((m) => m.group === g.id).map(toElkNode),
      layoutOptions: {
        'elk.padding': `[top=${GROUP_METRICS.paddingTop},left=${GROUP_METRICS.paddingSide},bottom=${GROUP_METRICS.paddingBottom},right=${GROUP_METRICS.paddingSide}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${Math.ceil(g.minW)},0)`,
        'elk.spacing.nodeNode': String(SPACING.node),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING.layer),
      },
    })
  }

  const edges: ElkExtendedEdge[] = input.edges.map((e) => {
    const main = e.kind === 'default' || e.kind === 'yes'
    const edge: ElkExtendedEdge = {
      id: e.id,
      sources: [e.from],
      targets: [e.to],
      layoutOptions: {
        // The happy path gets straightness priority so it stays in one line.
        'elk.layered.priority.straightness': main ? '10' : '1',
        'elk.layered.priority.shortness': main ? '5' : '1',
      },
    }
    if (e.label) {
      edge.labels = [
        {
          text: ' ',
          width: e.label.w,
          height: e.label.h,
          layoutOptions: { 'elk.edgeLabels.placement': 'TAIL' },
        },
      ]
    }
    return edge
  })

  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': dir === 'TB' ? 'DOWN' : 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': String(SPACING.node),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING.layer),
    'elk.spacing.edgeNode': String(SPACING.edgeNode),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(SPACING.edgeNode),
    'elk.spacing.edgeEdge': String(SPACING.edgeEdge),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(SPACING.edgeEdge),
    'elk.spacing.labelNode': '6',
    'elk.spacing.edgeLabel': '4',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.nodePlacement.favorStraightEdges': 'true',
    'elk.json.edgeCoords': 'ROOT',
    'elk.json.shapeCoords': 'ROOT',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  }
  Object.assign(layoutOptions, LAYOUT_OVERRIDES)
  if (hasGroups) layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN'
  if (wrap && !hasGroups) {
    layoutOptions['elk.layered.wrapping.strategy'] = 'MULTI_EDGE'
    layoutOptions['elk.layered.wrapping.correctionFactor'] = '1.2'
  }

  return { id: 'root', layoutOptions, children, edges }
}

function unionRect(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map((r) => r.x))
  const y1 = Math.min(...rs.map((r) => r.y))
  const x2 = Math.max(...rs.map((r) => r.x + r.w))
  const y2 = Math.max(...rs.map((r) => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export async function runElk(
  elk: ELK,
  input: LayoutInput,
  dir: Dir,
  wrap = false,
): Promise<LayoutResult> {
  const graph = buildElkGraph(input, dir, wrap)
  const out = await elk.layout(graph)

  const nodes: Record<string, Rect> = {}
  const groups: Record<string, Rect> = {}
  const nodeIds = new Set(input.nodes.map((n) => n.id))
  const groupIds = new Set(input.groups.map((g) => g.id))

  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const r = { x: (c.x ?? 0) + ox, y: (c.y ?? 0) + oy, w: c.width ?? 0, h: c.height ?? 0 }
      if (nodeIds.has(c.id)) nodes[c.id] = r
      else if (groupIds.has(c.id)) groups[c.id] = r
      // shapeCoords=ROOT already gives absolute coordinates, so children get no extra offset.
      walk(c, 0, 0)
    }
  }
  walk(out, 0, 0)

  const edges: LayoutResult['edges'] = {}
  for (const e of (out.edges ?? []) as ElkExtendedEdge[]) {
    const sec = e.sections?.[0]
    if (!sec) continue
    const pts: ElkPoint[] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
    const lab = e.labels?.[0]
    edges[e.id] = {
      points: pts.map((p) => ({ x: p.x, y: p.y })),
      label:
        lab && lab.x != null && lab.y != null
          ? { x: lab.x, y: lab.y, w: lab.width ?? 0, h: lab.height ?? 0 }
          : undefined,
    }
  }

  const all = [...Object.values(nodes), ...Object.values(groups)]
  const bounds = all.length ? unionRect(all) : { x: 0, y: 0, w: 0, h: 0 }
  return { direction: dir, wrapped: wrap, nodes, groups, edges, bounds }
}

export type Viewport = { w: number; h: number }
export const FIT_PADDING = 64
export const MAX_FIT_ZOOM = 1
export const MIN_READABLE_ZOOM = 0.6

export function fitZoom(bounds: Rect, viewport: Viewport): number {
  if (bounds.w <= 0 || bounds.h <= 0) return MAX_FIT_ZOOM
  const zx = (viewport.w - FIT_PADDING * 2) / bounds.w
  const zy = (viewport.h - FIT_PADDING * 2) / bounds.h
  return Math.min(MAX_FIT_ZOOM, zx, zy)
}

export type ChooseOptions = {
  direction: 'LR' | 'TB' | 'auto'
  viewport: Viewport
}

/**
 * Pick the final layout. Rules:
 *  - explicit direction is respected (but may wrap if it would be unreadable);
 *  - auto: TB, switching to LR when TB is much taller than wide (> 1.8x) with > 8 nodes;
 *  - if the fitted zoom would be < 0.6 for a < 20 node diagram, try the other direction / wrapping.
 */
export async function chooseLayout(
  elk: ELK,
  input: LayoutInput,
  opts: ChooseOptions,
): Promise<LayoutResult> {
  const count = input.nodes.length
  const explicit = opts.direction !== 'auto'
  const first: Dir = explicit ? (opts.direction as Dir) : 'TB'
  let best = await runElk(elk, input, first)

  if (!explicit && count > 8 && best.bounds.h > best.bounds.w * 1.8) {
    best = await runElk(elk, input, 'LR')
  }

  if (count < 20 && fitZoom(best.bounds, opts.viewport) < MIN_READABLE_ZOOM) {
    const candidates: LayoutResult[] = []
    if (!explicit) candidates.push(await runElk(elk, input, best.direction === 'TB' ? 'LR' : 'TB'))
    if (input.groups.length === 0) {
      candidates.push(await runElk(elk, input, best.direction, true))
      if (!explicit) candidates.push(await runElk(elk, input, best.direction === 'TB' ? 'LR' : 'TB', true))
    }
    for (const c of candidates) {
      if (fitZoom(c.bounds, opts.viewport) > fitZoom(best.bounds, opts.viewport) + 0.02) best = c
    }
  }
  return best
}
