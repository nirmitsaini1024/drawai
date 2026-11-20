import type { Editor, TLShapeId } from 'tldraw'
import type { SelectionBindingPayload, SelectionShapePayload } from './types'

function compactShapeProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  if (type === 'icon') {
    return {
      kind: props.kind,
      label: props.label,
      w: props.w,
      h: props.h,
      color: props.color,
    }
  }
  if (type === 'arrow') {
    return {
      label: richTextLabel(props.richText) ?? '',
      color: props.color,
    }
  }
  if (type === 'geo' || type === 'note' || type === 'text') {
    return {
      label: typeof props.label === 'string' ? props.label : richTextLabel(props.richText),
      w: props.w,
      h: props.h,
      color: props.color,
    }
  }
  // Keep a shallow JSON-safe subset
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    }
  }
  return out
}

function richTextLabel(richText: unknown): string | undefined {
  if (!richText || typeof richText !== 'object') return undefined
  const content = (richText as { content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const children = (block as { content?: unknown }).content
    if (!Array.isArray(children)) continue
    for (const child of children) {
      if (child && typeof child === 'object' && typeof (child as { text?: unknown }).text === 'string') {
        parts.push((child as { text: string }).text)
      }
    }
  }
  const text = parts.join('').trim()
  return text || undefined
}

/** Snapshot of selected shapes + arrow bindings that stay inside the selection. */
export function extractSelectionPayload(editor: Editor): {
  shapes: SelectionShapePayload[]
  bindings: SelectionBindingPayload[]
} | null {
  const selected = editor.getSelectedShapes()
  if (selected.length === 0) return null

  const idSet = new Set(selected.map((s) => s.id))
  const shapes: SelectionShapePayload[] = []

  for (const shape of selected) {
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) continue
    shapes.push({
      id: shape.id,
      type: shape.type,
      bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      props: compactShapeProps(shape.type, shape.props as Record<string, unknown>),
      locked: !!shape.isLocked,
    })
  }

  if (shapes.length === 0) return null

  const bindings: SelectionBindingPayload[] = []
  const seenArrows = new Set<string>()

  for (const shape of selected) {
    if (shape.type !== 'arrow') continue
    if (seenArrows.has(shape.id)) continue
    seenArrows.add(shape.id)

    const arrowBindings = editor.getBindingsFromShape(shape, 'arrow')
    let fromId: TLShapeId | undefined
    let toId: TLShapeId | undefined
    for (const b of arrowBindings) {
      const terminal = (b.props as { terminal?: string }).terminal
      if (terminal === 'start') fromId = b.toId
      if (terminal === 'end') toId = b.toId
    }
    if (!fromId || !toId) continue
    if (!idSet.has(fromId) || !idSet.has(toId)) continue

    const props = shape.props as { richText?: unknown }
    bindings.push({
      arrowId: shape.id,
      fromId,
      toId,
      label: richTextLabel(props.richText),
    })
  }

  return { shapes, bindings }
}

/** Optional PNG of the selection for vision context (base64, no data: prefix). */
export async function selectionImageBase64(
  editor: Editor,
  shapeIds: string[],
): Promise<string | undefined> {
  if (shapeIds.length === 0) return undefined
  try {
    const { blob } = await editor.toImage(shapeIds as TLShapeId[], {
      format: 'png',
      background: true,
      padding: 16,
      scale: 1,
    })
    if (blob.size > 1_500_000) return undefined
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  } catch {
    return undefined
  }
}
