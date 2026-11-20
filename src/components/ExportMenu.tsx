import { useRef, useState } from 'react'
import {
  exportBoardJson,
  exportBoardPng,
  exportBoardSvg,
  importBoardJson,
} from '../lib/exportBoard'
import { useAppStore } from '../store/appStore'

export function ExportMenu() {
  const editor = useAppStore((s) => s.editor)
  const getActiveBoard = useAppStore((s) => s.getActiveBoard)
  const persistCurrentBoard = useAppStore((s) => s.persistCurrentBoard)
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const boardName = getActiveBoard()?.name ?? 'Untitled'

  async function runExport(fn: () => Promise<void>) {
    if (!editor) return
    setOpen(false)
    await fn()
  }

  async function onImportFile(file: File | undefined) {
    if (!editor || !file) return
    try {
      await importBoardJson(editor, file)
      await persistCurrentBoard()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3 py-1.5 text-sm hover:bg-[var(--drawai-bg)]"
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-1 min-w-[10rem] overflow-hidden rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-surface)] shadow-lg">
            <MenuItem
              label="PNG"
              onClick={() => runExport(() => exportBoardPng(editor!, boardName))}
            />
            <MenuItem
              label="SVG"
              onClick={() => runExport(() => exportBoardSvg(editor!, boardName))}
            />
            <MenuItem
              label="JSON"
              onClick={() => runExport(() => exportBoardJson(editor!, boardName))}
            />
            <div className="border-t border-[var(--drawai-border)]" />
            <MenuItem
              label="Import JSON…"
              onClick={() => {
                setOpen(false)
                fileInputRef.current?.click()
              }}
            />
          </div>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,.tldr"
        className="hidden"
        onChange={(e) => {
          void onImportFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--drawai-bg)]"
      onClick={onClick}
    >
      {label}
    </button>
  )
}
