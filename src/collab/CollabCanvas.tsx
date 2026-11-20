import { useSync } from '@tldraw/sync'
import { useCallback, useEffect, type DragEvent } from 'react'
import { defaultBindingUtils, Tldraw, type Editor } from 'tldraw'
import { insertPresetShape, PRESET_DRAG_MIME } from '../library/insertPreset'
import { isPresetKind } from '../library/presetKinds'
import { insertLibraryContent } from '../library/shapeContent'
import { LIBRARY_DRAG_MIME } from '../library/types'
import { customShapeUtils, diagramThemes, syncShapeUtils } from '../shapes'
import { useAppStore } from '../store/appStore'
import { useLibraryStore } from '../store/libraryStore'
import { uiComponents, uiOverrides } from '../tldraw/uiConfig'
import { ShapesPanel } from '../components/ShapesPanel'
import { collabAssetStore } from './assets'
import { syncWsBase } from './roomRoute'

type Props = {
  roomId: string
  token: string
  /** UI hint only. The sync server enforces view-only from the link's role in the database. */
  readonly: boolean
}

export function CollabCanvas({ roomId, token, readonly }: Props) {
  const theme = useAppStore((s) => s.theme)
  const setEditor = useAppStore((s) => s.setEditor)
  const editor = useAppStore((s) => s.editor)

  const uri = `${syncWsBase()}/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`

  const store = useSync({
    uri,
    assets: collabAssetStore,
    shapeUtils: syncShapeUtils,
    bindingUtils: defaultBindingUtils,
  })

  const handleMount = useCallback(
    (ed: Editor) => {
      setEditor(ed)
      ed.user.updateUserPreferences({ colorScheme: theme })
      if (readonly) {
        ed.updateInstanceState({ isReadonly: true })
      }
      return () => setEditor(null)
    },
    [readonly, setEditor, theme],
  )

  useEffect(() => {
    if (!editor) return
    editor.updateInstanceState({ isReadonly: readonly })
  }, [editor, readonly])

  function onDragOver(e: DragEvent) {
    if (readonly) return
    const types = [...e.dataTransfer.types]
    if (!types.includes(LIBRARY_DRAG_MIME) && !types.includes(PRESET_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(e: DragEvent) {
    if (!editor || readonly) return
    const point = editor.screenToPage({ x: e.clientX, y: e.clientY })

    const presetKind = e.dataTransfer.getData(PRESET_DRAG_MIME)
    if (presetKind) {
      e.preventDefault()
      insertPresetShape(editor, isPresetKind(presetKind) ? presetKind : 'rect', point)
      return
    }

    const id = e.dataTransfer.getData(LIBRARY_DRAG_MIME)
    if (!id) return
    e.preventDefault()
    const item = useLibraryStore.getState().shapes.find((s) => s.id === id)
    if (!item) return
    insertLibraryContent(editor, item.content, point)
  }

  if (store.status === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--drawai-muted)]">
        Connecting to room <span className="ml-1 font-mono">{roomId}</span>…
      </div>
    )
  }

  if (store.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-[var(--drawai-danger)]">Could not join the room.</p>
        <p className="max-w-md text-xs text-[var(--drawai-muted)]">
          {store.error.message}
          <br />
          The sync server may be offline, or this link may have been revoked.
        </p>
        <a href="#/" className="text-sm text-[var(--drawai-accent)] underline">
          Back to local boards
        </a>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      {readonly && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-[250] flex justify-center">
          <div className="rounded-full border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3 py-1 text-xs font-medium shadow-md">
            View only · live
          </div>
        </div>
      )}
      <Tldraw
        store={store.store}
        onMount={handleMount}
        colorScheme={theme}
        overrides={uiOverrides}
        components={uiComponents}
        shapeUtils={customShapeUtils}
        themes={diagramThemes}
      />
      {!readonly && <ShapesPanel />}
    </div>
  )
}
