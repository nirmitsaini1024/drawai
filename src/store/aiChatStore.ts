import { create } from 'zustand'
import { applyGraphToEditor } from '../ai/applyGraph'
import {
  AiRateLimitError,
  AiRefusalError,
  requestDiagram,
  requestEdit,
} from '../ai/api'
import { applyEditOps } from '../ai/applyOps'
import { extractSelectionPayload, selectionImageBase64 } from '../ai/extractSelection'
import { formatRefusalMessage, MAX_PROMPT_CHARS } from '../ai/guardrails'
import { validateEditOps } from '../ai/validateOps'
import type { EditOp, Graph, SelectionShapePayload } from '../ai/types'
import { useAppStore } from './appStore'
import { useAiRateLimitStore } from './aiRateLimitStore'

export type AiChatMode = 'edit' | 'generate'

type AiChatState = {
  open: boolean
  mode: AiChatMode
  prompt: string
  loading: boolean
  error: string | null
  /** Soft refusal (out of scope) — not a scary error. */
  refusal: string | null
  lastGraph: Graph | null
  previewMark: string | null
  previewSummary: string | null
  previewOps: EditOp[]
  lastSelection: SelectionShapePayload[] | null
  setPrompt: (prompt: string) => void
  setMode: (mode: AiChatMode) => void
  clearError: () => void
  clearRefusal: () => void
  /** Open chat. With selection → edit; without → generate (unless forceMode). */
  openChat: (opts?: {
    mode?: AiChatMode
  }) => { ok: true; mode: AiChatMode } | { ok: false; reason: 'no-editor' }
  closeChat: () => void
  acceptPreview: () => void
  rejectPreview: () => void
  submit: (prompt?: string) => Promise<void>
}

export const useAiChatStore = create<AiChatState>((set, get) => ({
  open: false,
  mode: 'generate',
  prompt: '',
  loading: false,
  error: null,
  refusal: null,
  lastGraph: null,
  previewMark: null,
  previewSummary: null,
  previewOps: [],
  lastSelection: null,

  setPrompt: (prompt) => set({ prompt: prompt.slice(0, MAX_PROMPT_CHARS), refusal: null }),
  setMode: (mode) => set({ mode, error: null, refusal: null, prompt: '' }),
  clearError: () => set({ error: null }),
  clearRefusal: () => set({ refusal: null }),

  openChat: (opts) => {
    const editor = useAppStore.getState().editor
    if (!editor) return { ok: false as const, reason: 'no-editor' as const }

    const hasSelection = editor.getSelectedShapeIds().length > 0
    const mode: AiChatMode = opts?.mode ?? (hasSelection ? 'edit' : 'generate')

    if (mode === 'edit' && !hasSelection) {
      set({ open: true, mode: 'generate', error: null, refusal: null })
      return { ok: true as const, mode: 'generate' as const }
    }

    set({ open: true, mode, error: null, refusal: null })
    return { ok: true as const, mode }
  },

  closeChat: () => set({ open: false, error: null, refusal: null }),

  acceptPreview: () => {
    set({ previewMark: null, previewSummary: null, previewOps: [] })
  },

  rejectPreview: () => {
    const editor = useAppStore.getState().editor
    const mark = get().previewMark
    if (editor && mark) editor.bailToMark(mark)
    set({ previewMark: null, previewSummary: null, previewOps: [] })
  },

  submit: async (override) => {
    const editor = useAppStore.getState().editor
    if (!editor) {
      set({ error: 'Canvas is not ready yet' })
      return
    }

    if (get().loading) return

    const rate = useAiRateLimitStore.getState()
    if (!rate.canSubmit()) {
      const secs = rate.secondsUntilRetry()
      set({
        error: secs > 0 ? `Try again in ${secs}s` : 'Please wait a moment',
        refusal: null,
      })
      return
    }

    const prompt = (override ?? get().prompt).trim().slice(0, MAX_PROMPT_CHARS)
    if (!prompt) {
      set({ error: get().mode === 'generate' ? 'Describe a diagram first' : 'Enter an instruction' })
      return
    }

    if (get().previewMark) get().acceptPreview()

    const mode = get().mode
    rate.noteClientSubmit()
    set({ loading: true, error: null, refusal: null, open: true })

    try {
      if (mode === 'generate') {
        const graph = await requestDiagram({ prompt })
        await applyGraphToEditor(editor, graph)
        set({ lastGraph: graph, loading: false, prompt: '' })
        return
      }

      const payload = extractSelectionPayload(editor)
      if (!payload) {
        set({ loading: false, error: 'Select shapes to edit' })
        return
      }

      const image_base64 = await selectionImageBase64(
        editor,
        payload.shapes.map((s) => s.id),
      )
      const response = await requestEdit({
        prompt,
        shapes: payload.shapes,
        bindings: payload.bindings,
        image_base64,
      })

      const validated = validateEditOps(response.ops ?? [], payload.shapes)
      if (!validated.ok) {
        set({ loading: false, error: validated.error })
        return
      }
      if (validated.ops.length === 0) {
        set({
          loading: false,
          prompt: '',
          previewSummary: response.summary ?? 'No changes suggested',
          previewOps: [],
          previewMark: null,
          lastSelection: payload.shapes,
        })
        return
      }

      const mark = applyEditOps(editor, validated.ops)
      set({
        loading: false,
        prompt: '',
        previewMark: mark,
        previewOps: validated.ops,
        previewSummary: response.summary ?? `${validated.ops.length} edit(s) applied`,
        lastSelection: payload.shapes,
      })
    } catch (err) {
      if (err instanceof AiRefusalError) {
        set({
          loading: false,
          refusal: formatRefusalMessage(err.message),
          error: null,
        })
        return
      }
      if (err instanceof AiRateLimitError) {
        set({
          loading: false,
          error: `Try again in ${err.retryAfterSeconds}s`,
          refusal: null,
        })
        return
      }
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'AI request failed',
        refusal: null,
      })
    }
  },
}))
