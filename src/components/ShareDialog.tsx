import { useCallback, useEffect, useState } from 'react'
import { shareHash, shareUrl } from '../collab/roomRoute'
import {
  ApiError,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  rotateShareLink,
  type ShareLink,
  type ShareRole,
} from '../lib/api'
import { flushNow } from '../lib/sync'
import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'

const ROLE_LABEL: Record<ShareRole, string> = { edit: 'Can edit', view: 'View only' }

export function ShareDialog() {
  const open = useUiStore((s) => s.shareDialogOpen)
  const close = useUiStore((s) => s.closeShareDialog)
  const boardId = useAppStore((s) => s.activeBoardId)
  const persistCurrentBoard = useAppStore((s) => s.persistCurrentBoard)

  const [role, setRole] = useState<ShareRole>('view')
  const [links, setLinks] = useState<ShareLink[]>([])
  // Raw tokens only exist right after create/rotate (the server stores just a hash).
  const [fresh, setFresh] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 0) setError('Server unreachable. Try again when you are online.')
    else setError(err instanceof Error ? err.message : 'Something went wrong')
  }, [])

  const reload = useCallback(async () => {
    try {
      setLinks((await listShareLinks(boardId)).filter((l) => !l.revoked_at))
    } catch (err) {
      // 404 = the board has not reached the server yet; nothing to list.
      if (!(err instanceof ApiError && err.status === 404)) fail(err)
      setLinks([])
    }
  }, [boardId, fail])

  useEffect(() => {
    if (!open) return
    setFresh({})
    setError(null)
    setCopied(null)
    setBusy(true)
    // Make sure the server has the latest version of this board before we share it.
    void (async () => {
      await persistCurrentBoard()
      await flushNow()
      await reload()
      setBusy(false)
    })()
  }, [open, persistCurrentBoard, reload])

  if (!open) return null

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      await persistCurrentBoard()
      await flushNow()
      const link = await createShareLink(boardId, role)
      setFresh((f) => ({ ...f, [link.id]: link.token }))
      await reload()
    })

  const revoke = (id: string) =>
    run(async () => {
      await revokeShareLink(id)
      setFresh((f) => {
        const { [id]: _gone, ...rest } = f
        return rest
      })
      await reload()
    })

  const rotate = (id: string) =>
    run(async () => {
      const link = await rotateShareLink(id)
      setFresh((f) => {
        const { [id]: _old, ...rest } = f
        return { ...rest, [link.id]: link.token }
      })
      await reload()
    })

  async function copy(id: string, token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token))
      setCopied(id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Could not copy. Select the link and copy it manually.')
    }
  }

  function openLive(token: string) {
    close()
    window.location.hash = shareHash(token)
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="share-title"
        className="w-full max-w-lg rounded-lg border border-[var(--drawai-border)] bg-[var(--drawai-surface)] p-4 shadow-xl"
      >
        <h2 id="share-title" className="mb-2 text-base font-semibold">
          Share board
        </h2>
        <p className="mb-3 text-sm text-[var(--drawai-muted)]">
          Anyone with a link can join the live board, with the permission you choose. Revoking a
          link disconnects people using it within a few seconds.
        </p>

        <div className="mb-4 flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ShareRole)}
            disabled={busy}
            className="rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2 py-1.5 text-sm"
            aria-label="Permission"
          >
            <option value="view">{ROLE_LABEL.view}</option>
            <option value="edit">{ROLE_LABEL.edit}</option>
          </select>
          <button
            type="button"
            className="rounded-md bg-[var(--drawai-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--drawai-accent-hover)] disabled:opacity-50"
            disabled={busy || !boardId}
            onClick={() => void create()}
          >
            {busy ? 'Working…' : 'Create link'}
          </button>
        </div>

        <ul className="mb-3 max-h-64 space-y-2 overflow-y-auto">
          {links.length === 0 && (
            <li className="text-sm text-[var(--drawai-muted)]">No active links yet.</li>
          )}
          {links.map((link) => {
            const token = fresh[link.id]
            return (
              <li
                key={link.id}
                className="rounded-md border border-[var(--drawai-border)] p-2 text-sm"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{ROLE_LABEL[link.role]}</span>
                  <span className="text-[11px] text-[var(--drawai-muted)]">
                    created {new Date(link.created_at).toLocaleString()}
                  </span>
                </div>

                {token ? (
                  <div className="mb-2 flex gap-2">
                    <input
                      readOnly
                      value={shareUrl(token)}
                      className="min-w-0 flex-1 rounded-md border border-[var(--drawai-border)] bg-[var(--drawai-bg)] px-2 py-1.5 font-mono text-[11px]"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-[var(--drawai-border)] px-2 py-1 text-xs hover:bg-[var(--drawai-bg)]"
                      onClick={() => void copy(link.id, token)}
                    >
                      {copied === link.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <p className="mb-2 text-xs text-[var(--drawai-muted)]">
                    The URL is only shown when a link is created. Rotate it to get a new URL.
                  </p>
                )}

                <div className="flex gap-3 text-xs">
                  {token && (
                    <button
                      type="button"
                      className="text-[var(--drawai-accent)] disabled:opacity-50"
                      disabled={busy}
                      onClick={() => openLive(token)}
                    >
                      Open live board
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-[var(--drawai-muted)] hover:text-[var(--drawai-text)] disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void rotate(link.id)}
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    className="text-[var(--drawai-danger)] disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void revoke(link.id)}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {error && <p className="mb-3 text-sm text-[var(--drawai-danger)]">{error}</p>}

        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md border border-[var(--drawai-border)] px-3 py-1.5 text-sm"
            onClick={close}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
