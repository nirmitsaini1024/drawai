import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowShapeUtil, type TLArrowShape } from 'tldraw'
import {
  EDGE_METRICS,
  FONT_STACK,
  SKETCH_FONT_STACK,
  TYPOGRAPHY,
  edgeColors,
  type DiagramStyle,
} from '../lib/diagramTheme'

export type EdgeMeta = { kind: string; look: DiagramStyle }

export function readEdgeMeta(meta: unknown): EdgeMeta | null {
  const raw = (meta as { dgEdge?: EdgeMeta } | undefined)?.dgEdge
  return raw && typeof raw === 'object' ? raw : null
}

/**
 * Stock tldraw arrow, restyled for diagram edges (only arrows carrying `meta.dgEdge`): thin 1.5px
 * strokes, per-kind colors, small sans labels on a pill that cuts the line.
 */
const ConfiguredArrow = ArrowShapeUtil.configure({
  showTextOutline: false,
  getCustomDisplayValues(_editor, shape, _theme, colorMode) {
    const meta = readEdgeMeta(shape.meta)
    if (!meta) return {}
    const c = edgeColors(meta.kind, colorMode)
    const sketch = meta.look === 'sketch'
    return {
      strokeColor: c.stroke,
      strokeWidth: sketch ? 2 : EDGE_METRICS.strokeWidth,
      labelColor: c.label,
      labelFontFamily: sketch ? SKETCH_FONT_STACK : FONT_STACK,
      labelFontSize: TYPOGRAPHY.edgeLabel.size,
      labelLineHeight: TYPOGRAPHY.edgeLabel.lineHeight,
      labelPadding: 5,
      labelBorderRadius: 12,
    }
  },
})

const CORNER_RADIUS = 8

/** Rounds the corners of a polyline path made of M/L commands (quadratic corners). */
export function roundPath(d: string, r: number): string | null {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)
  if (!nums || /[^MLml\s,.\d-eE]/.test(d) || /[a-df-zA-DF-Z]/.test(d.replace(/[ML]/g, ''))) return null
  if (/[ml]/.test(d) && !/[ML]/.test(d)) return null
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i], y: +nums[i + 1] })
  if (pts.length < 3 || pts.length * 2 !== nums.length) return null
  const f = (n: number) => Math.round(n * 100) / 100
  let out = `M${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const l1 = Math.hypot(b.x - a.x, b.y - a.y)
    const l2 = Math.hypot(c.x - b.x, c.y - b.y)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    if (rr < 0.5) {
      out += ` L${f(b.x)} ${f(b.y)}`
      continue
    }
    const p1 = { x: b.x - ((b.x - a.x) / l1) * rr, y: b.y - ((b.y - a.y) / l1) * rr }
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr }
    out += ` L${f(p1.x)} ${f(p1.y)} Q${f(b.x)} ${f(b.y)} ${f(p2.x)} ${f(p2.y)}`
  }
  const last = pts[pts.length - 1]
  return `${out} L${f(last.x)} ${f(last.y)}`
}

/** Live-canvas only: rewrites the rendered body path of an elbow arrow with rounded corners. */
function RoundedCorners({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const apply = () => {
      root.querySelectorAll<SVGPathElement>('g[style*="clip-path"] > path').forEach((path) => {
        const d = path.getAttribute('d') ?? ''
        if (path.dataset.dgRounded === d) return
        const rounded = roundPath(d, CORNER_RADIUS)
        if (!rounded) return
        path.setAttribute('d', rounded)
        path.dataset.dgRounded = rounded
      })
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['d'] })
    return () => mo.disconnect()
  })
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}

export class DiagramArrowShapeUtil extends ConfiguredArrow {
  override component(shape: TLArrowShape) {
    const el = super.component(shape)
    if (shape.props.kind !== 'elbow' || !readEdgeMeta(shape.meta)) return el
    return <RoundedCorners>{el}</RoundedCorners>
  }
}
