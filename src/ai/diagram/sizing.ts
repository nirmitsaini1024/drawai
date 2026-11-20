/**
 * Content-aware node sizing. Text is measured with the real font (via an injected width function —
 * tldraw's text manager in the app, a fake in unit tests) and wrapped at a max width.
 */
import { EDGE_METRICS, NODE_METRICS, TYPOGRAPHY } from '../../lib/diagramTheme'
import type { NNode } from './normalize'
import type { NodeShape } from '../types'

export type FontSpec = { size: number; weight: number }
/** Width in px of `text` rendered on a single line. */
export type WidthFn = (text: string, font: FontSpec) => number

/** Render shapes: the logical shapes plus `hexagon`, used for long decision text. */
export type RenderShape = NodeShape | 'hexagon'

export type NodeSize = {
  w: number
  h: number
  shape: RenderShape
  lines: string[]
  descLines: string[]
  /** Width of the widest text line (for tests / layout of icon+text). */
  textW: number
}

const MIN: Record<RenderShape, { w: number; h: number }> = {
  terminator: { w: 120, h: 44 },
  process: { w: 120, h: 52 },
  decision: { w: 152, h: 88 },
  hexagon: { w: 160, h: 64 },
  io: { w: 140, h: 52 },
  data: { w: 120, h: 76 },
  person: { w: 130, h: 56 },
  service: { w: 140, h: 56 },
  document: { w: 120, h: 56 },
}

const even = (n: number) => Math.ceil(n / 2) * 2

export function wrapText(text: string, maxW: number, font: FontSpec, width: WidthFn): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    const push = () => {
      if (line) out.push(line)
      line = ''
    }
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (width(candidate, font) <= maxW) {
        line = candidate
        continue
      }
      push()
      if (width(word, font) <= maxW) {
        line = word
        continue
      }
      // Break an over-long word by characters.
      let chunk = ''
      for (const ch of word) {
        if (width(chunk + ch, font) > maxW && chunk) {
          out.push(chunk)
          chunk = ch
        } else chunk += ch
      }
      line = chunk
    }
    push()
  }
  return out.length ? out : ['']
}

const LABEL_FONT: FontSpec = { size: TYPOGRAPHY.label.size, weight: TYPOGRAPHY.label.weight }
const DESC_FONT: FontSpec = { size: TYPOGRAPHY.description.size, weight: TYPOGRAPHY.description.weight }

export const LABEL_LINE_H = Math.round(TYPOGRAPHY.label.size * TYPOGRAPHY.label.lineHeight)
export const DESC_LINE_H = Math.round(TYPOGRAPHY.description.size * TYPOGRAPHY.description.lineHeight)
const DESC_GAP = 2

type TextBlock = { lines: string[]; descLines: string[]; textW: number; textH: number }

function layoutText(label: string, description: string | undefined, maxW: number, width: WidthFn): TextBlock {
  const lines = wrapText(label, maxW, LABEL_FONT, width)
  const descLines = description ? wrapText(description, maxW, DESC_FONT, width).slice(0, 3) : []
  const textW = Math.max(
    ...lines.map((l) => width(l, LABEL_FONT)),
    ...descLines.map((l) => width(l, DESC_FONT)),
    0,
  )
  const textH =
    lines.length * LABEL_LINE_H + (descLines.length ? DESC_GAP + descLines.length * DESC_LINE_H : 0)
  return { lines, descLines, textW, textH }
}

export function measureNode(
  node: Pick<NNode, 'label' | 'description' | 'icon'> & { shape: RenderShape },
  width: WidthFn,
): NodeSize {
  const { padX, padY, maxWidth, iconSize, iconGap, skew, cap } = NODE_METRICS
  const iconExtra = node.icon ? iconSize + iconGap : 0
  let shape: RenderShape = node.shape

  const finish = (t: TextBlock, w: number, h: number): NodeSize => {
    const min = MIN[shape]
    return {
      w: even(Math.max(min.w, w)),
      h: even(Math.max(min.h, h)),
      shape,
      lines: t.lines,
      descLines: t.descLines,
      textW: t.textW,
    }
  }

  if (shape === 'decision') {
    const t = layoutText(node.label, node.description, 128, width)
    const w = t.textW + 1.8 * t.textH + 28
    if (t.lines.length <= 3 && w <= 264 && !node.description) {
      return finish(t, w, w / 1.8)
    }
    shape = 'hexagon'
  }

  if (shape === 'hexagon') {
    const t = layoutText(node.label, node.description, 176, width)
    return finish(t, t.textW + padX * 2 + 32, t.textH + padY * 2)
  }

  if (shape === 'terminator') {
    const t = layoutText(node.label, node.description, maxWidth - 56, width)
    return finish(t, t.textW + 56, t.textH + padY * 2)
  }

  if (shape === 'io') {
    const t = layoutText(node.label, node.description, 240 - padX * 2 - skew * 2 - iconExtra, width)
    return finish(t, t.textW + iconExtra + padX * 2 + skew * 2, t.textH + padY * 2)
  }

  if (shape === 'data') {
    const t = layoutText(node.label, node.description, maxWidth - padX * 2, width)
    return finish(t, t.textW + padX * 2, t.textH + padY * 2 + cap * 2)
  }

  // process / service / person / document
  const t = layoutText(node.label, node.description, maxWidth - padX * 2 - iconExtra, width)
  const docExtra = shape === 'document' ? 8 : 0
  return finish(
    t,
    t.textW + iconExtra + padX * 2,
    Math.max(t.textH, node.icon ? iconSize : 0) + padY * 2 + docExtra,
  )
}

export function measureEdgeLabel(text: string, width: WidthFn): { w: number; h: number } {
  const f: FontSpec = { size: TYPOGRAPHY.edgeLabel.size, weight: TYPOGRAPHY.edgeLabel.weight }
  return {
    w: even(width(text, f) + EDGE_METRICS.labelPadX * 2),
    h: even(f.size * TYPOGRAPHY.edgeLabel.lineHeight + EDGE_METRICS.labelPadY * 2),
  }
}

export function measureGroupTitle(text: string, width: WidthFn): number {
  return width(text, { size: TYPOGRAPHY.groupTitle.size, weight: TYPOGRAPHY.groupTitle.weight })
}
