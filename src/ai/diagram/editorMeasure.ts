import type { Editor } from 'tldraw'
import { fontFamilyFor, TYPOGRAPHY, type DiagramStyle } from '../../lib/diagramTheme'
import { measureNode, type FontSpec, type NodeSize, type RenderShape, type WidthFn } from './sizing'

/** Width function backed by tldraw's text manager (real browser font metrics). */
export function editorWidthFn(editor: Editor, style: DiagramStyle): WidthFn {
  const family = fontFamilyFor(style)
  const cache = new Map<string, number>()
  return (text: string, font: FontSpec) => {
    const key = `${font.size}|${font.weight}|${text}`
    const hit = cache.get(key)
    if (hit != null) return hit
    const m = editor.textMeasure.measureText(text, {
      fontStyle: 'normal',
      fontWeight: String(font.weight),
      fontFamily: family,
      fontSize: font.size,
      lineHeight: TYPOGRAPHY.label.lineHeight,
      maxWidth: null,
      minWidth: null,
      padding: '0px',
      otherStyles: { 'white-space': 'pre' },
    })
    cache.set(key, m.w)
    return m.w
  }
}

/** Make sure the diagram fonts are loaded so measurements match what is rendered. */
export async function ensureDiagramFonts(style: DiagramStyle): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const family = style === 'sketch' ? "'Shantell Sans'" : "'Inter Variable'"
  try {
    await Promise.all([
      document.fonts.load(`500 14px ${family}`),
      document.fonts.load(`400 12px ${family}`),
      document.fonts.load(`600 12px ${family}`),
    ])
  } catch {
    /* fall back to whatever is available */
  }
}

export type NodeContent = {
  label: string
  description?: string
  icon?: string
  shape: RenderShape
}

export function measureNodeInEditor(editor: Editor, node: NodeContent, style: DiagramStyle): NodeSize {
  return measureNode(node, editorWidthFn(editor, style))
}
