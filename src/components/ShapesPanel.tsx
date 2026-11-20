import { useMemo, useRef, useState } from 'react'
import { downloadText } from '../lib/download'
import { insertPresetShape, PRESET_DRAG_MIME } from '../library/insertPreset'
import { PRESET_CATEGORIES, type PresetCategory } from '../library/presetKinds'
import { PresetIcon } from '../library/presetIcons'
import { PRESETS, type PresetDefinition } from '../library/presets'
import { insertLibraryContent } from '../library/shapeContent'
import { LIBRARY_DRAG_MIME, type LibraryExportFile, type LibraryShape } from '../library/types'
import { useAppStore } from '../store/appStore'
import { useLibraryStore } from '../store/libraryStore'

type Tab = 'presets' | 'mine'

export function ShapesPanel() {
  const open = useLibraryStore((s) => s.panelOpen)
  const setPanelOpen = useLibraryStore((s) => s.setPanelOpen)
  const search = useLibraryStore((s) => s.search)
  const setSearch = useLibraryStore((s) => s.setSearch)
  const categoryFilter = useLibraryStore((s) => s.categoryFilter)
  const setCategoryFilter = useLibraryStore((s) => s.setCategoryFilter)
  const shapesTick = useLibraryStore((s) => s.shapes)
  const filteredShapes = useLibraryStore((s) => s.filteredShapes)
  const categories = useLibraryStore((s) => s.categories)
  const renameShape = useLibraryStore((s) => s.renameShape)
  const updateCategory = useLibraryStore((s) => s.updateCategory)
  const deleteShape = useLibraryStore((s) => s.deleteShape)
  const exportLibrary = useLibraryStore((s) => s.exportLibrary)
  const importLibrary = useLibraryStore((s) => s.importLibrary)
  const editor = useAppStore((s) => s.editor)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('presets')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [presetCategory, setPresetCategory] = useState<PresetCategory | 'all'>('all')

  const myItems = useMemo(
    () => filteredShapes(),
    [filteredShapes, shapesTick, search, categoryFilter],
  )
  const myCats = useMemo(() => categories(), [categories, shapesTick])

  const presetItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return PRESETS.filter((p) => {
      if (presetCategory !== 'all' && p.category !== presetCategory) return false
      if (!q) return true
      return (
        p.label.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    })
  }, [search, presetCategory])

  if (!open) return null

  function insertPreset(preset: PresetDefinition) {
    if (!editor) return
    insertPresetShape(editor, preset.kind)
  }

  function insertMine(item: LibraryShape) {
    if (!editor) return
    insertLibraryContent(editor, item.content)
  }

  function onExport() {
    downloadText(JSON.stringify(exportLibrary(), null, 2), 'drawai-library.json')
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as LibraryExportFile
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.shapes)) {
        throw new Error('Invalid library file')
      }
      const mode = window.confirm('Merge into library? Cancel = replace all.')
        ? 'merge'
        : 'replace'
      await importLibrary(parsed, mode)
      setTab('mine')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close shapes"
        className="absolute inset-0 z-40 bg-black/10"
        onClick={() => setPanelOpen(false)}
      />
      <aside className="absolute left-0 top-0 z-50 flex h-full w-80 flex-col border-r border-[var(--drawai-border)] bg-[var(--drawai-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--drawai-border)] px-3 py-3">
          <h2 className="text-sm font-semibold">Shapes</h2>
          <button
            type="button"
            className="rounded-md border border-[var(--drawai-border)] px-2 py-1 text-xs hover:bg-[var(--drawai-bg)]"
            onClick={() => setPanelOpen(false)}
          >
            Close
          </button>
        </div>

        <div className="flex border-b border-[var(--drawai-border)]">
          <TabButton active={tab === 'presets'} onClick={() => setTab('presets')} label="Presets" />
          <TabButton
            active={tab === 'mine'}
            onClick={() => setTab('mine')}
            label={`My shapes${shapesTick.length ? ` (${shapesTick.length})` : ''}`}
          />
        </div>

        <div className="space-y-2 border-b border-[var(--drawai-border)] p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'presets' ? 'Search presets…' : 'Search my shapes…'}
            className="w-full rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--drawai-accent)]"
          />
          {tab === 'presets' ? (
            <select
              value={presetCategory}
              onChange={(e) => setPresetCategory(e.target.value as PresetCategory | 'all')}
              className="w-full rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2.5 py-1.5 text-sm outline-none"
            >
              <option value="all">All categories</option>
              {PRESET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex gap-1">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2.5 py-1.5 text-sm outline-none"
              >
                <option value="all">All categories</option>
                {myCats.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-md border border-[var(--drawai-border)] px-2 text-xs hover:bg-[var(--drawai-bg)]"
                onClick={onExport}
              >
                Export
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--drawai-border)] px-2 text-xs hover:bg-[var(--drawai-bg)]"
                onClick={() => fileInputRef.current?.click()}
              >
                Import
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'presets' ? (
            presetItems.length === 0 ? (
              <p className="text-sm text-[var(--drawai-muted)]">No presets match.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {presetItems.map((preset) => (
                  <button
                    key={preset.kind}
                    type="button"
                    className="rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] p-2 text-left hover:border-[var(--drawai-accent)]"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PRESET_DRAG_MIME, preset.kind)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => insertPreset(preset)}
                    title="Click to insert · drag onto canvas"
                  >
                    <div className="mb-1.5 flex h-16 items-center justify-center rounded bg-[var(--drawai-surface)] p-2 text-[var(--drawai-text)]">
                      <PresetIcon kind={preset.kind} color="currentColor" />
                    </div>
                    <div className="truncate text-xs font-medium">{preset.label}</div>
                    <div className="truncate text-[10px] text-[var(--drawai-muted)]">
                      {preset.category}
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : myItems.length === 0 ? (
            <p className="text-sm text-[var(--drawai-muted)]">
              No saved shapes yet. Select shapes and use <strong>Save as shape</strong>.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {myItems.map((item) => (
                <MyShapeCard
                  key={item.id}
                  item={item}
                  menuOpen={menuId === item.id}
                  onToggleMenu={() => setMenuId((id) => (id === item.id ? null : item.id))}
                  onInsert={() => insertMine(item)}
                  onRename={() => {
                    const next = window.prompt('Rename shape', item.name)
                    if (next !== null) void renameShape(item.id, next)
                    setMenuId(null)
                  }}
                  onRecategorize={() => {
                    const next = window.prompt('Category', item.category)
                    if (next !== null) void updateCategory(item.id, next)
                    setMenuId(null)
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete “${item.name}”?`)) void deleteShape(item.id)
                    setMenuId(null)
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onImportFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </aside>
    </>
  )
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`flex-1 px-3 py-2 text-sm ${
        active
          ? 'border-b-2 border-[var(--drawai-accent)] font-medium text-[var(--drawai-text)]'
          : 'text-[var(--drawai-muted)] hover:text-[var(--drawai-text)]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function MyShapeCard({
  item,
  menuOpen,
  onToggleMenu,
  onInsert,
  onRename,
  onRecategorize,
  onDelete,
}: {
  item: LibraryShape
  menuOpen: boolean
  onToggleMenu: () => void
  onInsert: () => void
  onRename: () => void
  onRecategorize: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] p-2">
      <button
        type="button"
        className="block w-full text-left"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(LIBRARY_DRAG_MIME, item.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={onInsert}
        title="Click to insert · drag onto canvas"
      >
        <div className="mb-1.5 flex h-16 items-center justify-center overflow-hidden rounded bg-[var(--drawai-surface)]">
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <span className="text-xs text-[var(--drawai-muted)]">No preview</span>
          )}
        </div>
        <div className="truncate text-xs font-medium">{item.name}</div>
        <div className="truncate text-[10px] text-[var(--drawai-muted)]">{item.category}</div>
      </button>

      <button
        type="button"
        className="absolute right-1 top-1 rounded bg-[var(--drawai-surface)] px-1.5 py-0.5 text-[10px] opacity-0 shadow group-hover:opacity-100"
        onClick={onToggleMenu}
        aria-label="Shape options"
      >
        ···
      </button>

      {menuOpen && (
        <div className="absolute right-1 top-7 z-10 min-w-[7rem] overflow-hidden rounded border border-[var(--drawai-border)] bg-[var(--drawai-surface)] text-xs shadow-lg">
          <button type="button" className="block w-full px-2 py-1.5 text-left hover:bg-[var(--drawai-bg)]" onClick={onRename}>
            Rename
          </button>
          <button
            type="button"
            className="block w-full px-2 py-1.5 text-left hover:bg-[var(--drawai-bg)]"
            onClick={onRecategorize}
          >
            Category
          </button>
          <button
            type="button"
            className="block w-full px-2 py-1.5 text-left text-[var(--drawai-danger)] hover:bg-[var(--drawai-bg)]"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
