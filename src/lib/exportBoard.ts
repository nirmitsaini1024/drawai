import {
  exportAs,
  getSnapshot,
  parseTldrawJsonFile,
  serializeTldrawJson,
  type Editor,
  type TLEditorSnapshot,
  type TLShapeId,
} from 'tldraw'
import { downloadText, slugifyFilename } from './download'

function pageShapeIds(editor: Editor): TLShapeId[] {
  return [...editor.getCurrentPageShapeIds()]
}

export async function exportBoardPng(editor: Editor, boardName: string): Promise<void> {
  const ids = pageShapeIds(editor)
  if (ids.length === 0) {
    window.alert('Nothing to export — add some shapes first.')
    return
  }
  await exportAs(editor, ids, {
    format: 'png',
    name: slugifyFilename(boardName),
  })
}

export async function exportBoardSvg(editor: Editor, boardName: string): Promise<void> {
  const ids = pageShapeIds(editor)
  if (ids.length === 0) {
    window.alert('Nothing to export — add some shapes first.')
    return
  }
  await exportAs(editor, ids, {
    format: 'svg',
    name: slugifyFilename(boardName),
  })
}

export async function exportBoardJson(editor: Editor, boardName: string): Promise<void> {
  const json = await serializeTldrawJson(editor)
  downloadText(json, `${slugifyFilename(boardName)}.tldr.json`)
}

/** Accepts a tldraw `.tldr` JSON file or a raw `{ document, session }` snapshot. */
export async function importBoardJson(editor: Editor, file: File): Promise<void> {
  const text = await file.text()
  const parsed: unknown = JSON.parse(text)

  if (
    parsed &&
    typeof parsed === 'object' &&
    'tldrawFileFormatVersion' in parsed &&
    'records' in parsed
  ) {
    const result = parseTldrawJsonFile({
      json: text,
      schema: editor.store.schema,
    })
    if (!result.ok) {
      throw new Error(`Could not parse tldraw file (${result.error.type})`)
    }
    editor.loadSnapshot(getSnapshot(result.value), { forceOverwriteSessionState: true })
    return
  }

  if (parsed && typeof parsed === 'object' && 'document' in parsed) {
    editor.loadSnapshot(parsed as TLEditorSnapshot, { forceOverwriteSessionState: true })
    return
  }

  throw new Error('Unrecognized JSON board format')
}
