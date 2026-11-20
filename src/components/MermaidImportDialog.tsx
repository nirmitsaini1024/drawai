import { useEffect, useState } from 'react'
import { applyGraphToEditor } from '../ai/applyGraph'
import { requestMermaid } from '../ai/api'
import { useAiChatStore } from '../store/aiChatStore'
import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'

const SAMPLE = `flowchart LR
  User([User]) --> Gateway[API Gateway]
  Gateway --> API[API]
  API --> Cache[(Cache)]
  API --> DB[(Database)]`

export function MermaidImportDialog() {
  const open = useUiStore((s) => s.mermaidDialogOpen)
  const close = useUiStore((s) => s.closeMermaidDialog)
  const editor = useAppStore((s) => s.editor)

  const [source, setSource] = useState(SAMPLE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setError(null)
  }, [open])

  if (!open) return null

  async function onImport() {
    if (!editor) return
    const trimmed = source.trim()
    if (!trimmed) {
      setError('Paste Mermaid source first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const graph = await requestMermaid({ source: trimmed })
      await applyGraphToEditor(editor, graph)
      useAiChatStore.setState({ lastGraph: graph })
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="mermaid-title"
        className="w-full max-w-xl rounded-lg border border-[var(--drawai-border)] bg-[var(--drawai-surface)] p-4 shadow-xl"
      >
        <h2 id="mermaid-title" className="mb-3 text-base font-semibold">
          Import Mermaid
        </h2>
        <p className="mb-3 text-sm text-[var(--drawai-muted)]">
          Paste a Mermaid flowchart. Simple graphs convert locally; complex ones use the model.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={12}
          spellCheck={false}
          className="mb-3 w-full resize-y rounded-md border border-[var(--drawai-border)] bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--drawai-accent)]"
        />
        {error && <p className="mb-3 text-sm text-[var(--drawai-danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--drawai-border)] px-3 py-1.5 text-sm"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--drawai-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--drawai-accent-hover)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void onImport()}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
