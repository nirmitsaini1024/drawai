import { useUiStore } from '../store/uiStore'

export function ExplainDialog() {
  const open = useUiStore((s) => s.explainDialogOpen)
  const title = useUiStore((s) => s.explainTitle)
  const text = useUiStore((s) => s.explainText)
  const close = useUiStore((s) => s.closeExplainDialog)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="explain-title"
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border border-[var(--drawai-border)] bg-[var(--drawai-surface)] p-4 shadow-xl"
      >
        <h2 id="explain-title" className="mb-3 text-base font-semibold">
          {title}
        </h2>
        <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--drawai-text)]">
          {text}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md bg-[var(--drawai-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--drawai-accent-hover)]"
            onClick={close}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
