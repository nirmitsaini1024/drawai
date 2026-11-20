import { useEffect, useMemo, useState } from 'react'
import { captureSelectionAsContent, captureSelectionThumbnail } from '../library/shapeContent'
import { useAppStore } from '../store/appStore'
import { useLibraryStore } from '../store/libraryStore'

export function SaveAsShapeDialog() {
  const open = useLibraryStore((s) => s.saveDialogOpen)
  const closeSaveDialog = useLibraryStore((s) => s.closeSaveDialog)
  const addShape = useLibraryStore((s) => s.addShape)
  const shapes = useLibraryStore((s) => s.shapes)
  const editor = useAppStore((s) => s.editor)

  const existingCategories = useMemo(() => {
    return [...new Set(shapes.map((s) => s.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    )
  }, [shapes])
  const [name, setName] = useState('')
  const [category, setCategory] = useState('General')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setCategory(existingCategories[0] ?? 'General')
    setError(null)
    setBusy(false)
  }, [open, existingCategories])

  if (!open) return null

  async function onSave() {
    if (!editor) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const content = await captureSelectionAsContent(editor)
      if (!content) {
        setError('Select at least one shape first')
        setBusy(false)
        return
      }
      const thumbnail = await captureSelectionThumbnail(editor)
      await addShape({
        name: trimmedName,
        category: category.trim() || 'General',
        content,
        thumbnail,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save shape')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="save-shape-title"
        className="w-full max-w-md rounded-lg border border-[var(--drawai-border)] bg-[var(--drawai-surface)] p-4 shadow-xl"
      >
        <h2 id="save-shape-title" className="mb-3 text-base font-semibold">
          Save as shape
        </h2>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-[var(--drawai-muted)]">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSave()
            }}
            className="w-full rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2.5 py-2 outline-none focus:border-[var(--drawai-accent)]"
            placeholder="e.g. Auth flow"
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-[var(--drawai-muted)]">Category</span>
          <input
            list="drawai-library-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2.5 py-2 outline-none focus:border-[var(--drawai-accent)]"
            placeholder="General"
          />
          <datalist id="drawai-library-categories">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
            {!existingCategories.includes('General') && <option value="General" />}
          </datalist>
        </label>

        {error && <p className="mb-3 text-sm text-[var(--drawai-danger)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--drawai-border)] px-3 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
            onClick={closeSaveDialog}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--drawai-accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--drawai-accent-hover)] disabled:opacity-60"
            onClick={() => void onSave()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
