/**
 * Creates tldraw elbow arrows bound to diagram shapes. Anchors come from the layout (sides) and are
 * spread when several edges share a side; routes are then verified against the actual tldraw
 * routing and re-tried with alternative sides / midpoints when they cross other nodes.
 */
import {
  createShapeId,
  getArrowInfo,
  toRichText,
  type Editor,
  type JsonObject,
  type TLArrowBinding,
  type TLArrowShape,
  type TLShapeId,
} from 'tldraw'
import type { DiagramStyle } from '../../lib/diagramTheme'
import type { DiagramMeta } from '../../shapes/diagramTypes'
import type { EdgeKind } from '../types'
import type { Dir, Pt, Rect } from './layout'
import {
  assignAnchors,
  labelFraction,
  nodeHits,
  overlapLength,
  planSides,
  scoreRoute,
  type Anchor,
  type RoutingNode,
  type RouteContext,
  type Side,
} from './routing'

export type EdgeInput = {
  id: string
  from: TLShapeId
  to: TLShapeId
  label?: string
  kind: EdgeKind
  /** Optional ELK polyline (page coordinates) used to pick the sides. */
  hint?: Pt[]
}

export type EdgeOptions = {
  /** `auto` infers the dominant flow direction from the node positions. */
  direction: Dir | 'auto'
  look: DiagramStyle
  /** Extra meta merged into each arrow (e.g. the `drawai` marker). */
  meta?: JsonObject
}

const SIDES: Side[] = ['bottom', 'top', 'right', 'left']

function rectOf(editor: Editor, id: TLShapeId): Rect | null {
  const b = editor.getShapePageBounds(id)
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null
}

function shapeKind(editor: Editor, id: TLShapeId): string {
  const s = editor.getShape(id)
  if (s && s.type === 'dnode') return (s.props as { shape: string }).shape
  return 'process'
}

function sideAnchor(side: Side, t = 0.5): Anchor {
  switch (side) {
    case 'top':
      return { x: t, y: 0 }
    case 'bottom':
      return { x: t, y: 1 }
    case 'left':
      return { x: 0, y: t }
    case 'right':
      return { x: 1, y: t }
  }
}

function bindingProps(terminal: 'start' | 'end', a: Anchor) {
  return {
    terminal,
    normalizedAnchor: { x: a.x, y: a.y },
    isExact: false,
    isPrecise: true,
    snap: 'none' as const,
  }
}

function routePoints(editor: Editor, arrowId: TLShapeId): Pt[] | null {
  const shape = editor.getShape(arrowId)
  if (!shape) return null
  const info = getArrowInfo(editor, arrowId)
  if (!info || !info.isValid) return null
  const t = editor.getShapePageTransform(arrowId)
  const pts =
    info.type === 'elbow'
      ? info.route.points.map((p) => ({ x: p.x, y: p.y }))
      : [info.start.point, info.end.point].map((p) => ({ x: p.x, y: p.y }))
  return pts.map((p) => {
    const v = t.applyToPoint(p)
    return { x: v.x, y: v.y }
  })
}

export function createEdgeArrows(editor: Editor, edges: EdgeInput[], opts: EdgeOptions): TLShapeId[] {
  const nodeIds = [...new Set(edges.flatMap((e) => [e.from, e.to]))]
  const nodes: RoutingNode[] = []
  for (const id of nodeIds) {
    const rect = rectOf(editor, id)
    if (rect) nodes.push({ id, rect, shape: shapeKind(editor, id) })
  }
  const routable = edges.filter(
    (e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to),
  )
  const rectById0 = new Map(nodes.map((n) => [n.id, n.rect]))
  const hints: Record<string, Pt[]> = {}
  for (const e of routable) if (e.hint) hints[e.id] = e.hint

  const routingEdges = routable.map((e) => ({ id: e.id, from: e.from as string, to: e.to as string, kind: e.kind }))
  let direction: Dir
  if (opts.direction === 'auto') {
    let dxSum = 0
    let dySum = 0
    for (const e of routable) {
      const s = rectById0.get(e.from)!
      const t = rectById0.get(e.to)!
      dxSum += Math.abs(t.x + t.w / 2 - (s.x + s.w / 2))
      dySum += Math.abs(t.y + t.h / 2 - (s.y + s.h / 2))
    }
    direction = dySum >= dxSum ? 'TB' : 'LR'
  } else direction = opts.direction
  const plans = planSides(nodes, routingEdges, { direction, hints })
  const anchors = assignAnchors(nodes, routingEdges, plans)
  const rectById = new Map(nodes.map((n) => [n.id, n.rect]))

  const created: { arrowId: TLShapeId; edge: EdgeInput }[] = []

  for (const e of routable) {
    const a = anchors.get(e.id)
    const sRect = rectById.get(e.from)
    const tRect = rectById.get(e.to)
    if (!a || !sRect || !tRect) continue
    const sp = { x: sRect.x + sRect.w * a.start.x, y: sRect.y + sRect.h * a.start.y }
    const tp = { x: tRect.x + tRect.w * a.end.x, y: tRect.y + tRect.h * a.end.y }
    const arrowId = createShapeId()
    const meta: DiagramMeta & JsonObject = {}
    editor.createShape<TLArrowShape>({
      id: arrowId,
      type: 'arrow',
      x: sp.x,
      y: sp.y,
      meta: {
        ...(opts.meta ?? {}),
        dgEdge: { kind: e.kind, look: opts.look },
        ...meta,
      } as JsonObject,
      props: {
        kind: 'elbow',
        start: { x: 0, y: 0 },
        end: { x: tp.x - sp.x, y: tp.y - sp.y },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        size: 's',
        color: 'black',
        labelColor: 'black',
        font: opts.look === 'sketch' ? 'draw' : 'sans',
        dash: e.kind === 'async' ? 'dashed' : opts.look === 'sketch' ? 'draw' : 'solid',
        richText: toRichText(e.label ?? ''),
        elbowMidPoint: 0.5,
        labelPosition: 0.5,
      },
    })
    editor.createBindings([
      { type: 'arrow', fromId: arrowId, toId: e.from, props: bindingProps('start', a.start) },
      { type: 'arrow', fromId: arrowId, toId: e.to, props: bindingProps('end', a.end) },
    ])
    created.push({ arrowId, edge: e })
  }

  const finals = refineRoutes(editor, created, nodes, plans)

  // Place labels once every route is final, avoiding nodes and other edges.
  created.forEach(({ arrowId, edge }, i) => {
    if (!edge.label) return
    const pts = finals[i] ?? routePoints(editor, arrowId)
    if (!pts) return
    const size = labelSize(editor, arrowId)
    const ctx: RouteContext = {
      obstacles: nodes.filter((n) => n.id !== edge.from && n.id !== edge.to).map((n) => n.rect),
      others: finals.filter((_, j) => j !== i),
    }
    editor.updateShape<TLArrowShape>({
      id: arrowId,
      type: 'arrow',
      props: { labelPosition: labelFraction(pts, size, ctx) },
    })
  })
  return created.map((c) => c.arrowId)
}

function setRoute(
  editor: Editor,
  arrowId: TLShapeId,
  out: Side,
  inn: Side,
  mid: number,
  outT = 0.5,
  inT = 0.5,
) {
  const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow')
  for (const b of bindings) {
    const terminal = b.props.terminal
    const anchor = terminal === 'start' ? sideAnchor(out, outT) : sideAnchor(inn, inT)
    editor.updateBinding({ ...b, props: { ...b.props, normalizedAnchor: anchor } })
  }
  editor.updateShape<TLArrowShape>({ id: arrowId, type: 'arrow', props: { elbowMidPoint: mid } })
}

function refineRoutes(
  editor: Editor,
  created: { arrowId: TLShapeId; edge: EdgeInput }[],
  nodes: RoutingNode[],
  plans: Map<string, { out: Side; in: Side }>,
): Pt[][] {
  const finals: Pt[][] = []
  const contextFor = (edge: EdgeInput): RouteContext => ({
    obstacles: nodes.filter((n) => n.id !== edge.from && n.id !== edge.to).map((n) => n.rect),
    others: finals,
  })

  for (const { arrowId, edge } of created) {
    const ctx = contextFor(edge)
    const current = routePoints(editor, arrowId)
    let best = current
    const baseScore = current ? scoreRoute(current, ctx) : Infinity
    const clean = !!current && nodeHits(current, ctx) === 0
    const overlaps = current ? ctx.others.reduce((s, o) => s + overlapLength(current, o), 0) : 0
    if (current && clean && overlaps === 0) {
      finals.push(current)
      continue
    }

    const plan = plans.get(edge.id)
    const origBindings = editor.getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow')
    const origAnchors = new Map(origBindings.map((b) => [b.id, b.props.normalizedAnchor]))
    const origMid = (editor.getShape(arrowId) as TLArrowShape).props.elbowMidPoint
    let bestScore = baseScore
    let bestCfg: { out: Side; inn: Side; mid: number } | null = null
    const mids = [0.5, 0.25, 0.75, 0.12, 0.88]
    const combos: [Side, Side][] = []
    if (plan) combos.push([plan.out, plan.in])
    for (const o of SIDES) for (const i of SIDES) if (!plan || o !== plan.out || i !== plan.in) combos.push([o, i])

    outer: for (const [o, i] of combos) {
      for (const mid of mids) {
        setRoute(editor, arrowId, o, i, mid)
        const pts = routePoints(editor, arrowId)
        if (!pts) continue
        const s = scoreRoute(pts, ctx)
        if (s < bestScore - 0.001) {
          bestScore = s
          best = pts
          bestCfg = { out: o, inn: i, mid }
          if (nodeHits(pts, ctx) === 0 && ctx.others.every((x) => overlapLength(pts, x) === 0)) break outer
        }
      }
    }
    if (bestCfg) {
      setRoute(editor, arrowId, bestCfg.out, bestCfg.inn, bestCfg.mid)
    } else {
      // Nothing beat the planned route: restore it (including spread anchors).
      for (const b of editor.getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow')) {
        const anchor = origAnchors.get(b.id)
        if (anchor) editor.updateBinding({ ...b, props: { ...b.props, normalizedAnchor: anchor } })
      }
      editor.updateShape<TLArrowShape>({ id: arrowId, type: 'arrow', props: { elbowMidPoint: origMid } })
    }
    const finalPts = routePoints(editor, arrowId) ?? best
    finals.push(finalPts ?? [])
  }
  return finals
}

/** Approximate pill size of an arrow label (font 12px + padding). */
function labelSize(editor: Editor, arrowId: TLShapeId): { w: number; h: number } {
  const geo = editor.getShapeGeometry(arrowId)
  const label = (geo as unknown as { children?: { isLabel?: boolean; bounds: { w: number; h: number } }[] }).children?.find(
    (c) => c.isLabel,
  )
  return label ? { w: label.bounds.w, h: label.bounds.h } : { w: 36, h: 22 }
}
