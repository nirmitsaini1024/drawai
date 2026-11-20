import { useEffect, useState } from 'react'
import { shareUrl } from '../collab/roomRoute'
import { useSyncStatus } from '../lib/syncStatus'
import { useAppStore } from '../store/appStore'
import { useLibraryStore } from '../store/libraryStore'
import { useUiStore } from '../store/uiStore'
import { useDiagramStyleStore } from '../store/diagramStyleStore'
import { applyDiagramStyle } from '../ai/diagram/style'
import { tidySelection } from '../ai/diagram/tidy'
import { ExportMenu } from './ExportMenu'

type CollabInfo = { token: string; roomId: string | null; readonly: boolean }

export function TopBar({ collab }: { collab: CollabInfo | null }) {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const showGrid = useAppStore((s) => s.showGrid)
  const snapToGrid = useAppStore((s) => s.snapToGrid)
  const gridStyle = useAppStore((s) => s.gridStyle)
  const toggleShowGrid = useAppStore((s) => s.toggleShowGrid)
  const toggleSnapToGrid = useAppStore((s) => s.toggleSnapToGrid)
  const setGridStyle = useAppStore((s) => s.setGridStyle)
  const setBoardsDrawerOpen = useAppStore((s) => s.setBoardsDrawerOpen)
  const boardsDrawerOpen = useAppStore((s) => s.boardsDrawerOpen)
  const getActiveBoard = useAppStore((s) => s.getActiveBoard)
  const renameActiveBoard = useAppStore((s) => s.renameActiveBoard)
  const saveStatus = useAppStore((s) => s.saveStatus)
  const syncState = useSyncStatus((s) => s.state)
  const syncMessage = useSyncStatus((s) => s.message)
  const pending = useSyncStatus((s) => s.pending)
  const activeBoardId = useAppStore((s) => s.activeBoardId)
  const libraryOpen = useLibraryStore((s) => s.panelOpen)
  const setLibraryOpen = useLibraryStore((s) => s.setPanelOpen)
  const openCommandPalette = useUiStore((s) => s.openCommandPalette)
  const openShareDialog = useUiStore((s) => s.openShareDialog)

  const diagramStyle = useDiagramStyleStore((s) => s.style)
  const setDiagramStyle = useDiagramStyleStore((s) => s.setStyle)
  const editor = useAppStore((s) => s.editor)

  const board = getActiveBoard()
  const [name, setName] = useState(board?.name ?? 'Untitled')
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    setName(board?.name ?? 'Untitled')
  }, [board?.name, activeBoardId])

  function commitName() {
    const next = name.trim() || 'Untitled'
    setName(next)
    if (next !== board?.name) {
      void renameActiveBoard(next)
    }
  }

  async function copyCollabLink() {
    if (!collab) return
    try {
      await navigator.clipboard.writeText(shareUrl(collab.token))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3">
      {!collab && (
        <button
          type="button"
          className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
          onClick={() => {
            setLibraryOpen(false)
            setBoardsDrawerOpen(!boardsDrawerOpen)
          }}
          title="Boards"
        >
          Boards
        </button>
      )}

      {collab ? (
        <a
          href="#/"
          className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
          title="Leave live room"
        >
          Leave
        </a>
      ) : null}

      <button
        type="button"
        className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
        onClick={() => {
          setBoardsDrawerOpen(false)
          setLibraryOpen(!libraryOpen)
        }}
        title="Shapes library & presets"
        disabled={!!collab?.readonly}
      >
        Shapes
      </button>

      {collab ? (
        <div className="min-w-0 flex-1 truncate px-2 text-sm">
          <span className="font-medium">Live room</span>
          {!collab.roomId && (
            <span className="ml-2 text-xs text-[var(--drawai-muted)]">connecting…</span>
          )}
          {collab.readonly && (
            <span className="ml-2 rounded bg-[var(--drawai-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--drawai-muted)]">
              read-only
            </span>
          )}
        </div>
      ) : (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-[var(--drawai-border)] focus:border-[var(--drawai-accent)]"
          aria-label="Board name"
        />
      )}

      {!collab && (
        <SyncIndicator
          localFailed={saveStatus === 'error'}
          localPending={saveStatus === 'saving'}
          state={syncState}
          message={syncMessage}
          pending={pending}
        />
      )}

      <button
        type="button"
        className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
        onClick={openCommandPalette}
        title="Command palette (Ctrl/Cmd+K)"
      >
        ⌘K
      </button>

      {collab ? (
        <button
          type="button"
          className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
          onClick={() => void copyCollabLink()}
          title="Copy current share link"
        >
          {linkCopied ? 'Copied' : 'Copy link'}
        </button>
      ) : (
        <button
          type="button"
          className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
          onClick={openShareDialog}
          title="Share live collaboration link"
        >
          Share
        </button>
      )}

      {!collab?.readonly && (
        <>
          <button
            type="button"
            className="hidden rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)] sm:inline"
            onClick={() => useUiStore.getState().openImageDialog()}
            title="Image to diagram"
          >
            Image→AI
          </button>

          <button
            type="button"
            className="hidden rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)] md:inline"
            onClick={() => useUiStore.getState().openMermaidDialog()}
            title="Import Mermaid"
          >
            Mermaid
          </button>
        </>
      )}

      <ExportMenu />

      <button
        type="button"
        className={`rounded-md border px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)] ${
          showGrid
            ? 'border-[var(--drawai-accent)] text-[var(--drawai-accent)]'
            : 'border-[var(--drawai-border)]'
        }`}
        onClick={() => void toggleShowGrid()}
        title="Show grid (Ctrl/Cmd+')"
      >
        Grid
      </button>

      <button
        type="button"
        className={`hidden rounded-md border px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)] sm:inline ${
          snapToGrid
            ? 'border-[var(--drawai-accent)] text-[var(--drawai-accent)]'
            : 'border-[var(--drawai-border)]'
        }`}
        onClick={() => void toggleSnapToGrid()}
        title="Snap to grid (Ctrl/Cmd+Shift+')"
      >
        Snap
      </button>

      <button
        type="button"
        className="hidden rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)] md:inline"
        onClick={() => {
          const next = diagramStyle === 'clean' ? 'sketch' : 'clean'
          setDiagramStyle(next)
          if (editor) applyDiagramStyle(editor, next)
        }}
        title="Diagram style: Clean or Sketch (applies to selected or all diagram shapes)"
      >
        {diagramStyle === 'clean' ? 'Clean' : 'Sketch'}
      </button>

      <button
        type="button"
        className="hidden rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)] md:inline disabled:opacity-50"
        disabled={!editor}
        onClick={() => editor && void tidySelection(editor)}
        title="Tidy up: re-layout selected (or all) diagram nodes, no AI call"
      >
        Tidy up
      </button>

      <label className="hidden items-center gap-1 text-sm text-[var(--drawai-muted)] md:flex" title="Grid style">
        <span className="sr-only">Grid style</span>
        <select
          value={gridStyle}
          onChange={(e) => void setGridStyle(e.target.value as 'lines' | 'dots' | 'none')}
          className="rounded-md border border-[var(--drawai-border)] bg-transparent px-1.5 py-1.5 text-sm text-[var(--drawai-text)] outline-none hover:bg-[var(--drawai-bg)]"
        >
          <option value="lines">Lines</option>
          <option value="dots">Dots</option>
          <option value="none">None</option>
        </select>
      </label>

      <button
        type="button"
        className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
        onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
        title="Toggle theme"
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>

      <button
        type="button"
        className="rounded-md border border-[var(--drawai-border)] px-2.5 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
        onClick={() => window.dispatchEvent(new CustomEvent('drawai:open-shortcuts'))}
        title="Keyboard shortcuts (Ctrl/Cmd+Alt+/)"
      >
        ?
      </button>

      <span className="hidden text-sm font-semibold tracking-tight text-[var(--drawai-muted)] md:inline">
        DrawAI
      </span>
    </header>
  )
}

const SYNC_STYLE: Record<string, { label: string; dot: string }> = {
  saved: { label: 'Saved', dot: 'bg-emerald-500' },
  saving: { label: 'Saving…', dot: 'bg-amber-400' },
  offline: { label: 'Offline', dot: 'bg-slate-400' },
  conflict: { label: 'Conflict', dot: 'bg-orange-500' },
  error: { label: 'Save failed', dot: 'bg-red-500' },
}

function SyncIndicator({
  localFailed,
  localPending,
  state,
  message,
  pending,
}: {
  localFailed: boolean
  localPending: boolean
  state: string
  message: string | null
  pending: number
}) {
  const key = localFailed ? 'error' : localPending && state !== 'offline' ? 'saving' : state
  const style = SYNC_STYLE[key]
  if (!style) return null
  const suffix = key === 'offline' && pending > 0 ? ` (${pending} pending)` : ''
  const title =
    key === 'offline'
      ? 'Changes are saved in this browser and will sync when the server is reachable.'
      : (message ?? undefined)
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-[var(--drawai-muted)] sm:inline-flex"
      title={title}
      aria-live="polite"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
      {suffix}
    </span>
  )
}
