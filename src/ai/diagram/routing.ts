/**
 * Edge routing helpers (pure geometry): choose which side of each node an edge leaves / enters,
 * spread anchors when several edges share a side, and score candidate routes for collisions.
 */
import type { Dir, Pt, Rect } from './layout'

export type Side = 'top' | 'right' | 'bottom' | 'left'

export type RoutingNode = { id: string; rect: Rect; shape: string }
export type RoutingEdge = { id: string; from: string; to: string; kind: string }

export type SidePlan = { out: Side; in: Side }
export type Anchor = { x: number; y: number }

/** Shapes whose bounding box edge is (nearly) the visible outline, so anchors may be spread. */
const RECT_LIKE = new Set(['process', 'service', 'person', 'document'])

export const cx = (r: Rect) => r.x + r.w / 2
export const cy = (r: Rect) => r.y + r.h / 2

export function oppositeSide(s: Side): Side {
  return s === 'top' ? 'bottom' : s === 'bottom' ? 'top' : s === 'left' ? 'right' : 'left'
}

export function nearestSide(r: Rect, p: Pt): Side {
  const d: [Side, number][] = [
    ['top', Math.abs(p.y - r.y)],
    ['bottom', Math.abs(p.y - (r.y + r.h))],
    ['left', Math.abs(p.x - r.x)],
    ['right', Math.abs(p.x - (r.x + r.w))],
  ]
  d.sort((a, b) => a[1] - b[1])
  return d[0]![0]
}

export function geometricSides(s: Rect, t: Rect, dir: Dir): SidePlan {
  if (dir === 'TB') {
    if (t.y >= s.y + s.h - 4) return { out: 'bottom', in: 'top' }
    if (t.y + t.h <= s.y + 4) return { out: 'right', in: 'right' }
    return cx(t) >= cx(s) ? { out: 'right', in: 'left' } : { out: 'left', in: 'right' }
  }
  if (t.x >= s.x + s.w - 4) return { out: 'right', in: 'left' }
  if (t.x + t.w <= s.x + 4) return { out: 'bottom', in: 'bottom' }
  return cy(t) >= cy(s) ? { out: 'bottom', in: 'top' } : { out: 'top', in: 'bottom' }
}

export type PlanOptions = {
  direction: Dir
  /** Optional ELK polylines per edge id; their end sides are respected. */
  hints?: Record<string, Pt[]>
}

export function planSides(
  nodes: RoutingNode[],
  edges: RoutingEdge[],
  { direction, hints }: PlanOptions,
): Map<string, SidePlan> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const plans = new Map<string, SidePlan>()

  for (const e of edges) {
    const s = byId.get(e.from)
    const t = byId.get(e.to)
    if (!s || !t) continue
    const hint = hints?.[e.id]
    if (hint && hint.length >= 2) {
      plans.set(e.id, {
        out: nearestSide(s.rect, hint[0]!),
        in: nearestSide(t.rect, hint[hint.length - 1]!),
      })
    } else {
      plans.set(e.id, geometricSides(s.rect, t.rect, direction))
    }
  }

  // Decision branches: the "main" edge continues forward, the others leave through a side tip.
  const forwardOut: Side = direction === 'TB' ? 'bottom' : 'right'
  const forwardIn: Side = direction === 'TB' ? 'top' : 'left'
  for (const n of nodes) {
    if (n.shape !== 'decision' && n.shape !== 'hexagon') continue
    const outs = edges.filter((e) => e.from === n.id)
    if (outs.length < 2) continue
    const mainIdx = Math.max(
      0,
      outs.findIndex((e) => e.kind === 'yes' || e.kind === 'default'),
    )
    const used = new Set<Side>()
    outs.forEach((e, i) => {
      const plan = plans.get(e.id)
      const t = byId.get(e.to)
      if (!plan || !t) return
      if (i === mainIdx) {
        used.add(plan.out)
        return
      }
      const r = n.rect
      const offset = direction === 'TB' ? cx(t.rect) - cx(r) : cy(t.rect) - cy(r)
      const half = direction === 'TB' ? r.w / 2 : r.h / 2
      const isForward = plan.out === forwardOut
      if (isForward && Math.abs(offset) > half * 0.6) {
        const lateral: Side =
          direction === 'TB' ? (offset > 0 ? 'right' : 'left') : offset > 0 ? 'bottom' : 'top'
        if (!used.has(lateral)) {
          used.add(lateral)
          plans.set(e.id, { out: lateral, in: forwardIn })
          return
        }
      }
      used.add(plan.out)
    })
  }
  return plans
}

/**
 * Normalized anchors (0..1 inside each node's bounding box). Edges sharing one side of a
 * rectangular node are spread along that side so they never overlap.
 */
export function assignAnchors(
  nodes: RoutingNode[],
  edges: RoutingEdge[],
  plans: Map<string, SidePlan>,
): Map<string, { start: Anchor; end: Anchor }> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  type End = { edgeId: string; end: 'start' | 'end'; nodeId: string; side: Side; other: Rect }
  const ends: End[] = []
  for (const e of edges) {
    const plan = plans.get(e.id)
    const s = byId.get(e.from)
    const t = byId.get(e.to)
    if (!plan || !s || !t) continue
    ends.push({ edgeId: e.id, end: 'start', nodeId: e.from, side: plan.out, other: t.rect })
    ends.push({ edgeId: e.id, end: 'end', nodeId: e.to, side: plan.in, other: s.rect })
  }

  const frac = new Map<string, number>() // `${edgeId}:${end}` -> position along side (0..1)
  const groups = new Map<string, End[]>()
  for (const en of ends) {
    const key = `${en.nodeId}:${en.side}`
    const list = groups.get(key) ?? []
    list.push(en)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    const node = byId.get(list[0]!.nodeId)!
    const horizontalSide = list[0]!.side === 'top' || list[0]!.side === 'bottom'
    if (list.length === 1 || !RECT_LIKE.has(node.shape)) {
      for (const en of list) frac.set(`${en.edgeId}:${en.end}`, 0.5)
      continue
    }
    list.sort((a, b) => {
      const pa = horizontalSide ? cx(a.other) : cy(a.other)
      const pb = horizontalSide ? cx(b.other) : cy(b.other)
      return pa - pb || a.edgeId.localeCompare(b.edgeId)
    })
    // Keep the spread within the straight part of the side and at least ~14px apart.
    const len = horizontalSide ? node.rect.w : node.rect.h
    const span = Math.min(0.64, (list.length * 14) / len + 0.1)
    list.forEach((en, i) => {
      const t = list.length === 1 ? 0.5 : 0.5 - span / 2 + (span * i) / (list.length - 1)
      frac.set(`${en.edgeId}:${en.end}`, t)
    })
  }

  const toAnchor = (side: Side, t: number): Anchor => {
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

  const out = new Map<string, { start: Anchor; end: Anchor }>()
  for (const e of edges) {
    const plan = plans.get(e.id)
    if (!plan) continue
    out.set(e.id, {
      start: toAnchor(plan.out, frac.get(`${e.id}:start`) ?? 0.5),
      end: toAnchor(plan.in, frac.get(`${e.id}:end`) ?? 0.5),
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Collision scoring
// ---------------------------------------------------------------------------------------------

/** Does the segment a→b pass through the (inflated) rect interior? (Liang–Barsky). */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect, pad = 0): boolean {
  const x1 = r.x - pad
  const y1 = r.y - pad
  const x2 = r.x + r.w + pad
  const y2 = r.y + r.h + pad
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  return (
    clip(-dx, a.x - x1) && clip(dx, x2 - a.x) && clip(-dy, a.y - y1) && clip(dy, y2 - a.y) && t1 - t0 > 1e-6
  )
}

export function polylineHitsRect(pts: Pt[], r: Rect, pad = 0): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (segmentHitsRect(pts[i]!, pts[i + 1]!, r, pad)) return true
  }
  return false
}

/** Length of collinear overlap between two polylines' axis-aligned segments. */
export function overlapLength(a: Pt[], b: Pt[], tol = 1.5): number {
  let total = 0
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const p = a[i]!
      const q = a[i + 1]!
      const r = b[j]!
      const s = b[j + 1]!
      const aVert = Math.abs(p.x - q.x) < 0.01
      const bVert = Math.abs(r.x - s.x) < 0.01
      const aHor = Math.abs(p.y - q.y) < 0.01
      const bHor = Math.abs(r.y - s.y) < 0.01
      if (aVert && bVert && Math.abs(p.x - r.x) <= tol) {
        const lo = Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y))
        const hi = Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y))
        if (hi - lo > 0) total += hi - lo
      } else if (aHor && bHor && Math.abs(p.y - r.y) <= tol) {
        const lo = Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x))
        const hi = Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x))
        if (hi - lo > 0) total += hi - lo
      }
    }
  }
  return total
}

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(a, b, c)
  const d2 = o(a, b, d)
  const d3 = o(c, d, a)
  const d4 = o(c, d, b)
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

/** Number of proper crossings between two polylines (touching / collinear overlap excluded). */
export function crossings(a: Pt[], b: Pt[]): number {
  let n = 0
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      if (segsCross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) n++
    }
  }
  return n
}

export function polylineLength(pts: Pt[]): number {
  let len = 0
  for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y)
  return len
}

export type RouteContext = {
  /** Rects the route must not cross (all nodes except its own endpoints). */
  obstacles: Rect[]
  /** Already-final routes of other edges. */
  others: Pt[][]
}

export function nodeHits(pts: Pt[], ctx: RouteContext): number {
  return ctx.obstacles.filter((r) => polylineHitsRect(pts, r, 1)).length
}

/** Lower is better. */
export function scoreRoute(pts: Pt[], ctx: RouteContext): number {
  const hits = nodeHits(pts, ctx)
  let overlap = 0
  let cross = 0
  for (const o of ctx.others) {
    overlap += overlapLength(pts, o)
    cross += crossings(pts, o)
  }
  const bends = Math.max(0, pts.length - 2)
  return hits * 10_000 + Math.min(overlap, 400) * 5 + cross * 45 + bends * 12 + polylineLength(pts) / 25
}

/** Point at distance `d` along a polyline. */
function pointAt(pts: Pt[], d: number): Pt {
  let acc = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y)
    if (acc + len >= d || i === pts.length - 2) {
      const t = len === 0 ? 0 : Math.min(1, Math.max(0, (d - acc) / len))
      return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t }
    }
    acc += len
  }
  return pts[pts.length - 1]!
}

/**
 * Fraction (0..1) along a route at which a label should sit. Candidates are the midpoints of the
 * route's segments (so labels stay away from corners); the one whose pill touches the fewest
 * nodes / other edges wins, preferring long segments close to the start of the edge.
 */
export function labelFraction(
  pts: Pt[],
  label: { w: number; h: number } = { w: 32, h: 20 },
  ctx?: RouteContext,
): number {
  const total = polylineLength(pts)
  if (total <= 0 || pts.length < 2) return 0.5
  type Cand = { mid: number; score: number }
  const cands: Cand[] = []
  let acc = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y)
    const vertical = Math.abs(pts[i + 1]!.x - pts[i]!.x) < 0.01
    // Need room for the pill along the segment plus a little margin from the corners.
    const needed = (vertical ? label.h : label.w) + 16
    for (const f of len > needed * 1.8 ? [0.5, 0.3, 0.7] : [0.5]) {
      const mid = acc + len * f
      let score = -Math.min(len, 200) / 10 + i * 1.5 + Math.abs(f - 0.5) * 4
      if (len < needed) score += 40
      if (ctx) {
        const c = pointAt(pts, mid)
        const box: Rect = { x: c.x - label.w / 2, y: c.y - label.h / 2, w: label.w, h: label.h }
        for (const r of ctx.obstacles) if (rectsOverlap(box, r)) score += 500
        for (const o of ctx.others) {
          for (let j = 0; j + 1 < o.length; j++) {
            if (segmentHitsRect(o[j]!, o[j + 1]!, box, 3)) score += 120
          }
        }
      }
      cands.push({ mid, score })
    }
    acc += len
  }
  cands.sort((a, b) => a.score - b.score)
  return Math.min(0.95, Math.max(0.05, cands[0]!.mid / total))
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
