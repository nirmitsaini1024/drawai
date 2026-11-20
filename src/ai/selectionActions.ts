import { createShapeId, toRichText, type Editor } from 'tldraw'
import { AiRateLimitError, AiRefusalError, requestDiagram, requestExplain } from './api'
import { applyGraphToEditor } from './applyGraph'
import { tidySelection } from './diagram/tidy'
import { extractCurrentGraph } from './extractGraph'
import { extractSelectionPayload, selectionImageBase64 } from './extractSelection'
import { formatRefusalMessage } from './guardrails'
import { useAiRateLimitStore } from '../store/aiRateLimitStore'

export type SelectionActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }

async function selectionContext(editor: Editor) {
  const payload = extractSelectionPayload(editor)
  if (!payload) return null
  const image_base64 = await selectionImageBase64(
    editor,
    payload.shapes.map((s) => s.id),
  )
  return { ...payload, image_base64 }
}

function guardRate(): SelectionActionResult | null {
  const rate = useAiRateLimitStore.getState()
  if (!rate.canSubmit()) {
    const secs = rate.secondsUntilRetry()
    return { ok: false, error: secs > 0 ? `Try again in ${secs}s` : 'Please wait a moment' }
  }
  rate.noteClientSubmit()
  return null
}

function mapAiError(err: unknown, fallback: string): SelectionActionResult {
  if (err instanceof AiRefusalError) {
    return { ok: false, error: formatRefusalMessage(err.message) }
  }
  if (err instanceof AiRateLimitError) {
    return { ok: false, error: `Try again in ${err.retryAfterSeconds}s` }
  }
  return { ok: false, error: err instanceof Error ? err.message : fallback }
}

/** Tidy up: ELK re-layout of the selection, entirely local (no LLM call). */
export function runCleanUpLayout(editor: Editor): Promise<SelectionActionResult> {
  return tidySelection(editor)
}

export async function runExplainThis(editor: Editor): Promise<SelectionActionResult & { text?: string }> {
  const blocked = guardRate()
  if (blocked) return blocked
  const ctx = await selectionContext(editor)
  if (!ctx) return { ok: false, error: 'Select shapes to explain' }
  try {
    const { text } = await requestExplain({
      mode: 'explain',
      shapes: ctx.shapes,
      bindings: ctx.bindings,
      image_base64: ctx.image_base64,
    })
    return { ok: true, text, message: 'Explanation ready' }
  } catch (err) {
    return mapAiError(err, 'Explain failed')
  }
}

export async function runTurnIntoFlowchart(editor: Editor): Promise<SelectionActionResult> {
  const blocked = guardRate()
  if (blocked) return blocked
  const current = extractCurrentGraph(editor)
  if (!current || current.nodes.length === 0) {
    return { ok: false, error: 'Select diagram shapes (or generate one first)' }
  }
  try {
    const graph = await requestDiagram({
      prompt:
        'Rewrite this diagram as a clear flowchart. Prefer flowchart kinds ' +
        '(start-end, process, decision, input-output, document). Keep meaning; simplify labels.',
      current,
    })
    await applyGraphToEditor(editor, graph)
    return { ok: true, message: 'Converted to flowchart' }
  } catch (err) {
    return mapAiError(err, 'Flowchart conversion failed')
  }
}

export async function runSummarizeAsSticky(editor: Editor): Promise<SelectionActionResult> {
  const blocked = guardRate()
  if (blocked) return blocked
  const ctx = await selectionContext(editor)
  if (!ctx) return { ok: false, error: 'Select shapes to summarize' }
  try {
    const { text } = await requestExplain({
      mode: 'summarize',
      shapes: ctx.shapes,
      bindings: ctx.bindings,
      image_base64: ctx.image_base64,
    })

    const bounds = editor.getSelectionPageBounds()
    const x = bounds ? bounds.maxX + 40 : 100
    const y = bounds ? bounds.y : 100
    const id = createShapeId()

    editor.run(() => {
      editor.markHistoryStoppingPoint('ai-summarize-sticky')
      editor.createShape({
        id,
        type: 'note',
        x,
        y,
        props: {
          color: 'yellow',
          richText: toRichText(text),
        },
      })
      editor.select(id)
    })

    return { ok: true, message: 'Sticky note added' }
  } catch (err) {
    return mapAiError(err, 'Summarize failed')
  }
}
