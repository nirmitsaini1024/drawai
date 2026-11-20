import { GROUP_METRICS } from '../../lib/diagramTheme'
import type { LayoutResult, Rect } from './layout'

export const GRID = 8

const snap = (v: number, grid: number) => Math.round(v / grid) * grid

function contains(outer: Rect, inner: Rect, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  )
}

function unionRect(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map((r) => r.x))
  const y1 = Math.min(...rs.map((r) => r.y))
  const x2 = Math.max(...rs.map((r) => r.x + r.w))
  const y2 = Math.max(...rs.map((r) => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/**
 * Snap node *centres* to the grid (so nodes of different widths in one column stay aligned) and
 * grow group containers outward to the grid — then re-fit each group around its members so
 * centre-snapping never pushes a child past the group edge (which looked like side blocks vanishing).
 */
export function snapLayout(layout: LayoutResult, grid = GRID): LayoutResult {
  const nodes: Record<string, Rect> = {}
  const deltas: Record<string, { dx: number; dy: number }> = {}
  for (const [id, r] of Object.entries(layout.nodes)) {
    const x = snap(r.x + r.w / 2, grid) - r.w / 2
    const y = snap(r.y + r.h / 2, grid) - r.h / 2
    nodes[id] = { x, y, w: r.w, h: r.h }
    deltas[id] = { dx: x - r.x, dy: y - r.y }
  }

  const groups: Record<string, Rect> = {}
  for (const [id, r] of Object.entries(layout.groups)) {
    // Members that were inside the pre-snap group (ELK always nests them that way).
    const members = Object.entries(layout.nodes)
      .filter(([, n]) => contains(r, n))
      .map(([nid]) => nodes[nid]!)

    let x1 = Math.floor(r.x / grid) * grid
    let y1 = Math.floor(r.y / grid) * grid
    let x2 = Math.ceil((r.x + r.w) / grid) * grid
    let y2 = Math.ceil((r.y + r.h) / grid) * grid

    if (members.length > 0) {
      const padL = GROUP_METRICS.paddingSide
      const padR = GROUP_METRICS.paddingSide
      const padT = GROUP_METRICS.paddingTop
      const padB = GROUP_METRICS.paddingBottom
      const body = unionRect(members)
      x1 = Math.min(x1, Math.floor((body.x - padL) / grid) * grid)
      y1 = Math.min(y1, Math.floor((body.y - padT) / grid) * grid)
      x2 = Math.max(x2, Math.ceil((body.x + body.w + padR) / grid) * grid)
      y2 = Math.max(y2, Math.ceil((body.y + body.h + padB) / grid) * grid)
    }

    groups[id] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }

  // Shift ELK edge hints by the same snap delta as their nearest endpoint node so side picking
  // still matches the moved boxes.
  const edges: LayoutResult['edges'] = {}
  for (const [id, e] of Object.entries(layout.edges)) {
    if (e.points.length === 0) {
      edges[id] = e
      continue
    }
    const start = e.points[0]!
    const end = e.points[e.points.length - 1]!
    let startDelta = { dx: 0, dy: 0 }
    let endDelta = { dx: 0, dy: 0 }
    let bestStart = Infinity
    let bestEnd = Infinity
    for (const [nid, r] of Object.entries(layout.nodes)) {
      const d = deltas[nid]!
      const ds = Math.hypot(start.x - (r.x + r.w / 2), start.y - (r.y + r.h / 2))
      const de = Math.hypot(end.x - (r.x + r.w / 2), end.y - (r.y + r.h / 2))
      if (ds < bestStart) {
        bestStart = ds
        startDelta = d
      }
      if (de < bestEnd) {
        bestEnd = de
        endDelta = d
      }
    }
    const midDx = (startDelta.dx + endDelta.dx) / 2
    const midDy = (startDelta.dy + endDelta.dy) / 2
    edges[id] = {
      ...e,
      points: e.points.map((p, i) => {
        if (i === 0) return { x: p.x + startDelta.dx, y: p.y + startDelta.dy }
        if (i === e.points.length - 1) return { x: p.x + endDelta.dx, y: p.y + endDelta.dy }
        return { x: p.x + midDx, y: p.y + midDy }
      }),
      label: e.label
        ? { ...e.label, x: e.label.x + midDx, y: e.label.y + midDy }
        : undefined,
    }
  }

  const all = [...Object.values(nodes), ...Object.values(groups)]
  if (all.length === 0) {
    return { ...layout, nodes, groups, edges, bounds: { x: 0, y: 0, w: 0, h: 0 } }
  }
  const bounds = unionRect(all)
  return { ...layout, nodes, groups, edges, bounds }
}
