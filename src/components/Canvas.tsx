import { useCallback, useEffect, useRef, type DragEvent } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import { installDevHooks } from '../ai/devHooks'
import { insertPresetShape, PRESET_DRAG_MIME } from '../library/insertPreset'
import { isPresetKind } from '../library/presetKinds'
import { insertLibraryContent } from '../library/shapeContent'
import { LIBRARY_DRAG_MIME } from '../library/types'
import { customShapeUtils, diagramThemes } from '../shapes'
import { useAppStore } from '../store/appStore'
import { useLibraryStore } from '../store/libraryStore'
import { uiComponents, uiOverrides } from '../tldraw/uiConfig'
import { BoardsDrawer } from './BoardsDrawer'
import { ShapesPanel } from './ShapesPanel'

const AUTOSAVE_MS = 600

export function Canvas() {
  const initialSnapshot = useAppStore((s) => s.initialSnapshot)
  const theme = useAppStore((s) => s.theme)
  const setEditor = useAppStore((s) => s.setEditor)
  const persistCurrentBoard = useAppStore((s) => s.persistCurrentBoard)
  const setSaveStatus = useAppStore((s) => s.setSaveStatus)
  const editor = useAppStore((s) => s.editor)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistRef = useRef(persistCurrentBoard)
  persistRef.current = persistCurrentBoard

  const scheduleSave = useCallback(() => {
    setSaveStatus('idle')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void persistRef.current()
    }, AUTOSAVE_MS)
  }, [setSaveStatus])

  const handleMount = useCallback(
    (ed: Editor) => {
      setEditor(ed)
      installDevHooks(ed)
      ed.user.updateUserPreferences({ colorScheme: theme })

      const unsub = ed.store.listen(
        () => {
          // Ignore snapshots we loaded ourselves (board switch / remote update).
          if (useAppStore.getState().quietLoad) return
          scheduleSave()
        },
        { scope: 'document', source: 'user' },
      )

      return () => {
        unsub()
        setEditor(null)
        if (saveTimer.current) clearTimeout(saveTimer.current)
      }
    },
    [scheduleSave, setEditor, theme],
  )

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  function onDragOver(e: DragEvent) {
    const types = [...e.dataTransfer.types]
    if (!types.includes(LIBRARY_DRAG_MIME) && !types.includes(PRESET_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(e: DragEvent) {
    if (!editor) return
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

  return (
    <div className="relative min-h-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <Tldraw
        snapshot={initialSnapshot ?? undefined}
        onMount={handleMount}
        colorScheme={theme}
        overrides={uiOverrides}
        components={uiComponents}
        shapeUtils={customShapeUtils}
        themes={diagramThemes}
      />
      <BoardsDrawer />
      <ShapesPanel />
    </div>
  )
}
