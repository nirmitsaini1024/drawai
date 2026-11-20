import { useEffect, useRef, useState } from 'react'
import { applyGraphToEditor } from '../ai/applyGraph'
import { requestDiagramFromImage } from '../ai/api'
import { useAppStore } from '../store/appStore'
import { useAiChatStore } from '../store/aiChatStore'
import { useUiStore } from '../store/uiStore'

function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const match = /^data:([^;]+);base64,(.+)$/.exec(result)
      if (!match) {
        reject(new Error('Invalid image data'))
        return
      }
      resolve({ mediaType: match[1]!, base64: match[2]! })
    }
    reader.readAsDataURL(file)
  })
}

export function ImageToDiagramDialog() {
  const open = useUiStore((s) => s.imageDialogOpen)
  const close = useUiStore((s) => s.closeImageDialog)
  const editor = useAppStore((s) => s.editor)

  const inputRef = useRef<HTMLInputElement>(null)
  const [prompt, setPrompt] = useState('Convert this sketch into a clear diagram.')
  const [preview, setPreview] = useState<string | null>(null)
  const [fileMeta, setFileMeta] = useState<{ base64: string; mediaType: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPrompt('Convert this sketch into a clear diagram.')
    setPreview(null)
    setFileMeta(null)
    setBusy(false)
    setError(null)
  }, [open])

  if (!open) return null

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose a PNG, JPEG, WebP, or GIF image')
      return
    }
    if (file.size > 4_000_000) {
      setError('Image must be under 4MB')
      return
    }
    try {
      const meta = await fileToBase64(file)
      const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
      if (!allowed.includes(meta.mediaType)) {
        setError('Unsupported image type')
        return
      }
      setFileMeta(meta)
      setPreview(`data:${meta.mediaType};base64,${meta.base64}`)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read image')
    }
  }

  async function onConvert() {
    if (!editor || !fileMeta) {
      setError('Pick an image first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const graph = await requestDiagramFromImage({
        image_base64: fileMeta.base64,
        media_type: fileMeta.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
        prompt: prompt.trim() || undefined,
      })
      await applyGraphToEditor(editor, graph)
      useAiChatStore.setState({ lastGraph: graph })
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="image-diagram-title"
        className="w-full max-w-lg rounded-lg border border-[var(--drawai-border)] bg-[var(--drawai-surface)] p-4 shadow-xl"
      >
        <h2 id="image-diagram-title" className="mb-3 text-base font-semibold">
          Image to diagram
        </h2>
        <p className="mb-3 text-sm text-[var(--drawai-muted)]">
          Upload a photo of a hand-drawn sketch. Vision converts it into DrawAI shapes.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />

        <button
          type="button"
          className="mb-3 w-full rounded-md border border-dashed border-[var(--drawai-border)] px-3 py-6 text-sm hover:bg-[var(--drawai-bg)]"
          onClick={() => inputRef.current?.click()}
        >
          {preview ? 'Replace image' : 'Choose image…'}
        </button>

        {preview && (
          <img
            src={preview}
            alt="Sketch preview"
            className="mb-3 max-h-48 w-full rounded-md border border-[var(--drawai-border)] object-contain"
          />
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-[var(--drawai-muted)]">Optional hint</span>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full rounded-md border border-[var(--drawai-border)] bg-transparent px-2 py-1.5 outline-none focus:border-[var(--drawai-accent)]"
          />
        </label>

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
            disabled={busy || !fileMeta}
            onClick={() => void onConvert()}
          >
            {busy ? 'Converting…' : 'Convert'}
          </button>
        </div>
      </div>
    </div>
  )
}
