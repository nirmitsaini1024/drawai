import { useSync } from '@tldraw/sync'
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  atom,
  createUserId,
  defaultBindingUtils,
  Tldraw,
  UserRecordType,
  type Editor,
  type Signal,
  type TLUser,
} from 'tldraw'
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
import { getCollabIdentity, subscribeCollabIdentity, type CollabIdentity } from './identity'
import { syncWsBase } from './roomRoute'

function toUserRecord(identity: CollabIdentity) {
  return UserRecordType.create({
    id: createUserId(identity.id),
    name: identity.name,
    color: identity.color,
    imageUrl: '',
    meta: {},
  })
}

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

  const currentUser = useMemo(
    () => atom('drawai-collab-user', toUserRecord(getCollabIdentity())),
    [],
  )

  const users = useMemo(
    () => ({ currentUser: currentUser as Signal<null | TLUser> }),
    [currentUser],
  )

  useEffect(() => {
    return subscribeCollabIdentity((identity) => {
      currentUser.set(toUserRecord(identity))
      const ed = useAppStore.getState().editor
      ed?.user.updateUserPreferences({
        name: identity.name,
        color: identity.color,
        id: identity.id,
      })
    })
  }, [currentUser])

  const store = useSync({
    uri,
    assets: collabAssetStore,
    shapeUtils: syncShapeUtils,
    bindingUtils: defaultBindingUtils,
    users,
  })

  const handleMount = useCallback(
    (ed: Editor) => {
      setEditor(ed)
      const identity = getCollabIdentity()
      ed.user.updateUserPreferences({
        colorScheme: theme,
        name: identity.name,
        color: identity.color,
        id: identity.id,
      })
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

  const [you, setYou] = useState(() => getCollabIdentity())
  useEffect(() => subscribeCollabIdentity(setYou), [])

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

  const connectionOk = store.status === 'synced-remote' && store.connectionStatus === 'online'

  return (
    <div className="relative min-h-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="pointer-events-none absolute inset-x-0 top-2 z-[250] flex justify-center gap-2">
        {readonly && (
          <div className="rounded-full border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3 py-1 text-xs font-medium shadow-md">
            View only · live
          </div>
        )}
        <div
          className={`rounded-full border px-3 py-1 text-xs font-medium shadow-md ${
            connectionOk
              ? 'border-[var(--drawai-border)] bg-[var(--drawai-surface)]'
              : 'border-amber-500/40 bg-[var(--drawai-surface)] text-amber-700 dark:text-amber-300'
          }`}
        >
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
              connectionOk ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            aria-hidden
          />
          {connectionOk ? 'Live' : 'Reconnecting…'}
          <span className="ml-2 text-[var(--drawai-muted)]">you: {you.name}</span>
        </div>
      </div>
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
