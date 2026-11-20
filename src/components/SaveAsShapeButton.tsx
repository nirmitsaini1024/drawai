import { useEditor, useValue } from 'tldraw'
import { useLibraryStore } from '../store/libraryStore'

export function SaveAsShapeButton() {
  const editor = useEditor()
  const selectedCount = useValue(
    'drawai-selected-count',
    () => editor.getSelectedShapeIds().length,
    [editor],
  )
  const openSaveDialog = useLibraryStore((s) => s.openSaveDialog)

  if (selectedCount === 0) return null

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 z-[300] -translate-x-1/2"
      style={{ pointerEvents: 'all' }}
    >
      <button
        type="button"
        className="rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3 py-1.5 text-sm shadow-md hover:bg-[var(--drawai-bg)]"
        onClick={() => openSaveDialog()}
        title="Save as shape (Ctrl/Cmd+Shift+U)"
      >
        Save as shape
        <span className="ml-2 text-[11px] text-[var(--drawai-muted)]">
          {selectedCount} selected
        </span>
      </button>
    </div>
  )
}
