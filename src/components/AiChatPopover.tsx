import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor, useValue } from 'tldraw'
import { EDIT_QUICK_ACTIONS } from '../ai/types'
import { useAiChatStore, type AiChatMode } from '../store/aiChatStore'

const GENERATE_CHIPS = [
  '3-tier web app with cache',
  'CI/CD pipeline',
  'Auth flow flowchart',
  'Event-driven microservices',
] as const

export function AiChatPopover() {
  const editor = useEditor()
  const open = useAiChatStore((s) => s.open)
  const mode = useAiChatStore((s) => s.mode)
  const setMode = useAiChatStore((s) => s.setMode)
  const prompt = useAiChatStore((s) => s.prompt)
  const setPrompt = useAiChatStore((s) => s.setPrompt)
  const loading = useAiChatStore((s) => s.loading)
  const error = useAiChatStore((s) => s.error)
  const previewMark = useAiChatStore((s) => s.previewMark)
  const previewSummary = useAiChatStore((s) => s.previewSummary)
  const previewOps = useAiChatStore((s) => s.previewOps)
  const closeChat = useAiChatStore((s) => s.closeChat)
  const openChat = useAiChatStore((s) => s.openChat)
  const acceptPreview = useAiChatStore((s) => s.acceptPreview)
  const rejectPreview = useAiChatStore((s) => s.rejectPreview)
  const submit = useAiChatStore((s) => s.submit)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; anchored: boolean } | null>(null)

  const selectedCount = useValue(
    'ai-chat-selected-count',
    () => editor.getSelectedShapeIds().length,
    [editor],
  )
  const selectionBounds = useValue(
    'ai-chat-selection-bounds',
    () => editor.getSelectionPageBounds(),
    [editor],
  )

  const hasSelection = selectedCount > 0

  useLayoutEffect(() => {
    if (!open || !editor) {
      setPos(null)
      return
    }

    const container = editor.getContainer().getBoundingClientRect()

    if (mode === 'edit' && selectionBounds) {
      const screen = editor.pageToScreen({
        x: selectionBounds.midX,
        y: selectionBounds.maxY + 14,
      })
      setPos({
        left: clamp(screen.x - container.left, 210, container.width - 210),
        top: Math.min(screen.y - container.top, container.height - 220),
        anchored: true,
      })
      return
    }

    // Generate mode — float near bottom-center of viewport (Cursor-like)
    setPos({
      left: container.width / 2,
      top: Math.max(80, container.height - 220),
      anchored: false,
    })
  }, [open, editor, mode, selectionBounds])

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeChat()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, closeChat])

  // Floating "Ask AI" chip under selection when closed
  if (!open) {
    if (!hasSelection || !selectionBounds || !editor) return null
    const container = editor.getContainer().getBoundingClientRect()
    const screen = editor.pageToScreen({
      x: selectionBounds.midX,
      y: selectionBounds.maxY + 10,
    })
    const left = clamp(screen.x - container.left, 80, container.width - 80)
    const top = screen.y - container.top

    return (
      <div
        className="pointer-events-none absolute z-[250]"
        style={{ left, top, transform: 'translateX(-50%)' }}
      >
        <button
          type="button"
          className="pointer-events-auto rounded-full border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3 py-1 text-xs font-medium shadow-md hover:border-[var(--drawai-accent)] hover:text-[var(--drawai-accent)]"
          onClick={() => openChat({ mode: 'edit' })}
          title="Ask AI about selection (Ctrl/Cmd+I)"
        >
          Ask AI <span className="ml-1 text-[var(--drawai-muted)]">⌘I</span>
        </button>
      </div>
    )
  }

  if (!pos) return null

  const hasPreview = !!previewMark && previewOps.length > 0
  const chips = mode === 'edit' ? EDIT_QUICK_ACTIONS : GENERATE_CHIPS

  return (
    <div
      className="pointer-events-none absolute z-[260]"
      style={{
        left: pos.left,
        top: pos.top,
        transform: 'translateX(-50%)',
        width: 'min(440px, calc(100% - 24px))',
      }}
    >
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-[var(--drawai-border)] bg-[var(--drawai-surface)] shadow-2xl">
        <div className="flex items-center gap-1 border-b border-[var(--drawai-border)] p-1.5">
          <ModeTab
            active={mode === 'edit'}
            disabled={!hasSelection}
            onClick={() => setMode('edit')}
            title={hasSelection ? 'Edit the current selection' : 'Select shapes first'}
          >
            Edit selection
          </ModeTab>
          <ModeTab active={mode === 'generate'} onClick={() => setMode('generate')}>
            Generate new
          </ModeTab>
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-1 text-xs text-[var(--drawai-muted)] hover:bg-[var(--drawai-bg)]"
            onClick={closeChat}
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-[var(--drawai-border)] px-3 py-2">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={loading}
              onClick={() => {
                setPrompt(chip)
                void submit(chip)
              }}
              className="rounded-full border border-[var(--drawai-border)] px-2 py-0.5 text-[11px] text-[var(--drawai-muted)] hover:border-[var(--drawai-accent)] hover:text-[var(--drawai-accent)] disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        {error && (
          <div className="border-b border-[var(--drawai-border)] px-3 py-2 text-xs text-[var(--drawai-danger)]">
            {error}
          </div>
        )}

        {(hasPreview || (mode === 'edit' && previewSummary)) && (
          <div className="flex items-center gap-2 border-b border-[var(--drawai-border)] px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-[var(--drawai-muted)]">
              {previewSummary}
              {hasPreview ? ` · ${previewOps.length} op(s)` : ''}
            </p>
            {hasPreview && (
              <>
                <button
                  type="button"
                  onClick={rejectPreview}
                  className="rounded-md border border-[var(--drawai-border)] px-2 py-1 text-xs hover:bg-[var(--drawai-bg)]"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={acceptPreview}
                  className="rounded-md bg-[var(--drawai-accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--drawai-accent-hover)]"
                >
                  Accept
                </button>
              </>
            )}
          </div>
        )}

        <form
          className="p-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <textarea
            ref={inputRef}
            value={prompt}
            rows={2}
            disabled={loading}
            placeholder={
              mode === 'edit'
                ? 'Ask AI to change the selection…'
                : 'Describe a new diagram to generate…'
            }
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-60"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                closeChat()
              }
            }}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="mt-1 flex items-center justify-between gap-2 px-1">
            <span className="text-[10px] text-[var(--drawai-muted)]">
              Enter send · Shift+Enter newline
            </span>
            <button
              type="submit"
              disabled={loading || !prompt.trim() || (mode === 'edit' && !hasSelection)}
              className="rounded-lg bg-[var(--drawai-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--drawai-accent-hover)] disabled:opacity-50"
            >
              {loading ? 'Working…' : mode === 'edit' ? 'Apply' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModeTab({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={
        active
          ? 'rounded-md bg-[var(--drawai-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--drawai-accent)]'
          : 'rounded-md px-2.5 py-1 text-xs text-[var(--drawai-muted)] hover:bg-[var(--drawai-bg)] disabled:opacity-40'
      }
    >
      {children}
    </button>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/** Floating launcher when nothing is selected — bottom-right, opens Generate. */
export function AiChatLauncher() {
  const open = useAiChatStore((s) => s.open)
  const openChat = useAiChatStore((s) => s.openChat)
  if (open) return null

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-[240]">
      <button
        type="button"
        className="pointer-events-auto rounded-full border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3.5 py-2 text-sm font-medium shadow-lg hover:border-[var(--drawai-accent)] hover:text-[var(--drawai-accent)]"
        onClick={() => openChat({ mode: 'generate' })}
        title="Generate a new diagram (Ctrl/Cmd+I)"
      >
        AI <span className="ml-1 text-xs text-[var(--drawai-muted)]">⌘I</span>
      </button>
    </div>
  )
}

export type { AiChatMode }
