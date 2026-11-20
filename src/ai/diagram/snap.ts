import type { LayoutResult, Rect } from './layout'

export const GRID = 8

const snap = (v: number, grid: number) => Math.round(v / grid) * grid

/**
 * Snap node *centres* to the grid (so nodes of different widths in one column stay aligned) and
 * grow group containers outward to the grid. Returns a new result; edge polylines are only hints
 * after this step and are shifted by the owning nodes' delta by the caller if needed.
 */
export function snapLayout(layout: LayoutResult, grid = GRID): LayoutResult {
  const nodes: Record<string, Rect> = {}
  for (const [id, r] of Object.entries(layout.nodes)) {
    const x = snap(r.x + r.w / 2, grid) - r.w / 2
    const y = snap(r.y + r.h / 2, grid) - r.h / 2
    nodes[id] = { x, y, w: r.w, h: r.h }
  }
  const groups: Record<string, Rect> = {}
  for (const [id, r] of Object.entries(layout.groups)) {
    const x1 = Math.floor(r.x / grid) * grid
    const y1 = Math.floor(r.y / grid) * grid
    const x2 = Math.ceil((r.x + r.w) / grid) * grid
    const y2 = Math.ceil((r.y + r.h) / grid) * grid
    groups[id] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
  const all = [...Object.values(nodes), ...Object.values(groups)]
  const x1 = Math.min(...all.map((r) => r.x))
  const y1 = Math.min(...all.map((r) => r.y))
  const x2 = Math.max(...all.map((r) => r.x + r.w))
  const y2 = Math.max(...all.map((r) => r.y + r.h))
  return { ...layout, nodes, groups, bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } }
}
