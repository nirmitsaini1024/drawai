import { useEffect, useMemo, useRef, useState } from 'react'
import { getCommandItems, type CommandItem } from '../lib/commands'
import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const close = useUiStore((s) => s.closeCommandPalette)
  const editor = useAppStore((s) => s.editor)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const all = getCommandItems()
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((item) => {
      const hay = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''} ${item.group}`.toLowerCase()
      return hay.includes(q)
    })
  }, [query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  if (!open) return null

  function run(item: CommandItem) {
    close()
    item.run(editor)
  }

  const groups = groupItems(items)

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/40 p-4 pt-[12vh]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={close} />
      <div
        role="dialog"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg border border-[var(--drawai-border)] bg-[var(--drawai-surface)] shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
              return
            }
            if (e.key === 'Enter' && items[index]) {
              e.preventDefault()
              run(items[index])
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-[var(--drawai-border)] bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--drawai-muted)]">No matching commands</p>
          ) : (
            groups.map(({ group, items: groupItems }) => (
              <div key={group} className="mb-2">
                <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--drawai-muted)]">
                  {group}
                </div>
                {groupItems.map((item) => {
                  const flatIndex = items.indexOf(item)
                  const active = flatIndex === index
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                        active ? 'bg-[var(--drawai-accent)] text-white' : 'hover:bg-[var(--drawai-bg)]'
                      }`}
                      onMouseEnter={() => setIndex(flatIndex)}
                      onClick={() => run(item)}
                    >
                      <span>{item.label}</span>
                      {item.hint && (
                        <span className={`text-[11px] ${active ? 'text-white/80' : 'text-[var(--drawai-muted)]'}`}>
                          {item.hint}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[var(--drawai-border)] px-4 py-2 text-[11px] text-[var(--drawai-muted)]">
          ↑↓ navigate · Enter run · Esc close
        </div>
      </div>
    </div>
  )
}

function groupItems(items: CommandItem[]) {
  const order: CommandItem['group'][] = ['DrawAI', 'Insert', 'View', 'Export', 'Edit']
  return order
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0)
}
