import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'

export function BoardsDrawer() {
  const open = useAppStore((s) => s.boardsDrawerOpen)
  const setBoardsDrawerOpen = useAppStore((s) => s.setBoardsDrawerOpen)
  const boards = useAppStore((s) => s.boards)
  const activeBoardId = useAppStore((s) => s.activeBoardId)
  const addBoard = useAppStore((s) => s.addBoard)
  const openBoard = useAppStore((s) => s.openBoard)
  const removeBoard = useAppStore((s) => s.removeBoard)
  const renameActiveBoard = useAppStore((s) => s.renameActiveBoard)
  const refreshFromServer = useAppStore((s) => s.refreshFromServer)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Pull the latest boards from the server whenever the drawer opens (IndexedDB is the fallback).
  useEffect(() => {
    if (open) void refreshFromServer()
  }, [open, refreshFromServer])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        aria-label="Close boards"
        className="absolute inset-0 z-40 bg-black/20"
        onClick={() => setBoardsDrawerOpen(false)}
      />
      <aside className="absolute left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-[var(--drawai-border)] bg-[var(--drawai-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--drawai-border)] px-3 py-3">
          <h2 className="text-sm font-semibold">Boards</h2>
          <button
            type="button"
            className="rounded-md bg-[var(--drawai-accent)] px-2.5 py-1 text-sm text-white hover:bg-[var(--drawai-accent-hover)]"
            onClick={() => void addBoard()}
          >
            New
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto p-2">
          {boards.map((board) => {
            const isActive = board.id === activeBoardId
            const isRenaming = renamingId === board.id

            return (
              <li
                key={board.id}
                className={`mb-1 rounded-md border px-2 py-2 ${
                  isActive
                    ? 'border-[var(--drawai-accent)] bg-[var(--drawai-bg)]'
                    : 'border-transparent hover:bg-[var(--drawai-bg)]'
                }`}
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      if (isActive) {
                        void renameActiveBoard(renameValue)
                      }
                      setRenamingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="w-full rounded border border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-1.5 py-1 text-sm outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    className="w-full text-left text-sm font-medium"
                    onClick={() => void openBoard(board.id)}
                    onDoubleClick={() => {
                      if (!isActive) return
                      setRenamingId(board.id)
                      setRenameValue(board.name)
                    }}
                  >
                    {board.name}
                  </button>
                )}

                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--drawai-muted)]">
                    {new Date(board.updatedAt).toLocaleString()}
                  </span>
                  <div className="flex gap-1">
                    {isActive && (
                      <button
                        type="button"
                        className="text-[11px] text-[var(--drawai-muted)] hover:text-[var(--drawai-text)]"
                        onClick={() => {
                          setRenamingId(board.id)
                          setRenameValue(board.name)
                        }}
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[11px] text-[var(--drawai-danger)] disabled:opacity-40"
                      disabled={boards.length <= 1}
                      onClick={() => {
                        if (window.confirm(`Delete “${board.name}”?`)) {
                          void removeBoard(board.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </aside>
    </>
  )
}
