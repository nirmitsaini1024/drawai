import type { Editor, TLContent, VecLike } from 'tldraw'

export async function captureSelectionAsContent(editor: Editor): Promise<TLContent | undefined> {
  const ids = editor.getSelectedShapeIds()
  if (ids.length === 0) return undefined
  const content = editor.getContentFromCurrentPage(ids)
  return editor.resolveAssetsInContent(content)
}

export async function captureSelectionThumbnail(editor: Editor): Promise<string> {
  const ids = [...editor.getSelectedShapeIds()]
  if (ids.length === 0) return ''

  try {
    const result = await editor.toImageDataUrl(ids, {
      format: 'png',
      background: false,
      padding: 16,
      scale: 1,
    })
    return result.url
  } catch {
    const svg = await editor.getSvgString(ids, { padding: 16 })
    if (!svg) return ''
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.svg)}`
  }
}

export function insertLibraryContent(
  editor: Editor,
  content: TLContent,
  point?: VecLike,
): void {
  const target =
    point ??
    (() => {
      const bounds = editor.getViewportPageBounds()
      return { x: bounds.midX, y: bounds.midY }
    })()

  editor.markHistoryStoppingPoint('insert-library-shape')
  editor.putContentOntoCurrentPage(content, {
    point: target,
    select: true,
  })
}
