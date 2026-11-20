/** SVG path builders for diagram node shapes (pure, shared by render, indicator, export). */
import { NODE_METRICS } from '../lib/diagramTheme'

export type NodePaths = {
  /** Main outline (filled + stroked). */
  d: string
  /** Optional extra stroked line (cylinder rim, document fold). */
  extra?: string
}

const f = (n: number) => Math.round(n * 100) / 100

export function hexSlant(h: number): number {
  return Math.min(20, h / 2)
}

export function polygonPoints(shape: string, w: number, h: number): [number, number][] | null {
  switch (shape) {
    case 'decision':
      return [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]
    case 'hexagon': {
      const s = hexSlant(h)
      return [
        [s, 0],
        [w - s, 0],
        [w, h / 2],
        [w - s, h],
        [s, h],
        [0, h / 2],
      ]
    }
    case 'io': {
      const k = Math.min(NODE_METRICS.skew, w / 4)
      return [
        [k, 0],
        [w, 0],
        [w - k, h],
        [0, h],
      ]
    }
    default:
      return null
  }
}

function roundedRect(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M${f(rr)} 0H${f(w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(w)} ${f(rr)}` +
    `V${f(h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(w - rr)} ${f(h)}` +
    `H${f(rr)}A${f(rr)} ${f(rr)} 0 0 1 0 ${f(h - rr)}V${f(rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} 0Z`
  )
}

export function nodePaths(shape: string, w: number, h: number): NodePaths {
  const pts = polygonPoints(shape, w, h)
  if (pts) {
    return { d: `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z` }
  }
  switch (shape) {
    case 'terminator':
      return { d: roundedRect(w, h, h / 2) }
    case 'data': {
      const cap = NODE_METRICS.cap
      const rx = w / 2
      return {
        d:
          `M0 ${cap}A${f(rx)} ${cap} 0 0 1 ${f(w)} ${cap}V${f(h - cap)}` +
          `A${f(rx)} ${cap} 0 0 1 0 ${f(h - cap)}Z`,
        extra: `M0 ${cap}A${f(rx)} ${cap} 0 0 0 ${f(w)} ${cap}`,
      }
    }
    case 'document': {
      const r = NODE_METRICS.radius
      const rr = Math.min(r, w / 2, h / 2)
      const wave = 8
      return {
        d:
          `M${f(rr)} 0H${f(w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(w)} ${f(rr)}V${f(h - wave)}` +
          `C${f(w * 0.8)} ${f(h - wave * 2.2)} ${f(w * 0.65)} ${f(h + wave * 0.2)} ${f(w / 2)} ${f(h - wave)}` +
          `S${f(w * 0.2)} ${f(h - wave * 2)} 0 ${f(h - wave)}V${f(rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} 0Z`,
      }
    }
    default:
      return { d: roundedRect(w, h, NODE_METRICS.radius) }
  }
}

/** Inner box (relative to the node) where icon + text are laid out. */
export function contentBox(shape: string, w: number, h: number): { x: number; y: number; w: number; h: number } {
  switch (shape) {
    case 'decision':
      return { x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }
    case 'hexagon':
      return { x: hexSlant(h) + 8, y: 0, w: w - 2 * (hexSlant(h) + 8), h }
    case 'io':
      return { x: NODE_METRICS.skew + 6, y: 0, w: w - 2 * (NODE_METRICS.skew + 6), h }
    case 'data':
      return { x: 0, y: NODE_METRICS.cap * 1.6, w, h: h - NODE_METRICS.cap * 2.4 }
    case 'document':
      return { x: 0, y: 0, w, h: h - 8 }
    default:
      return { x: 0, y: 0, w, h }
  }
}
