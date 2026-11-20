import { useState } from 'react'
import { dismissLegacyImport, importLegacyLocalData } from '../lib/sync'
import { useSyncStatus } from '../lib/syncStatus'

/** One-time offer to upload boards/shapes that only exist in this browser (from before server sync). */
export function ImportLocalBanner() {
  const legacy = useSyncStatus((s) => s.legacy)
  const [busy, setBusy] = useState(false)

  if (!legacy) return null

  const parts = [
    legacy.boards > 0 && `${legacy.boards} board${legacy.boards === 1 ? '' : 's'}`,
    legacy.shapes > 0 && `${legacy.shapes} saved shape${legacy.shapes === 1 ? '' : 's'}`,
  ].filter(Boolean)

  return (
    <div
      role="status"
      className="z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--drawai-border)] bg-[var(--drawai-surface)] px-3 py-2 text-sm"
    >
      <span className="min-w-0 flex-1">
        {parts.join(' and ')} exist only in this browser. Import them to the server so they are backed up
        and available everywhere?
      </span>
      <button
        type="button"
        disabled={busy}
        className="rounded-md bg-[var(--drawai-accent)] px-3 py-1 text-white hover:bg-[var(--drawai-accent-hover)] disabled:opacity-50"
        onClick={() => {
          setBusy(true)
          void importLegacyLocalData().finally(() => setBusy(false))
        }}
      >
        {busy ? 'Importing…' : 'Import local data to the server'}
      </button>
      <button
        type="button"
        disabled={busy}
        className="rounded-md border border-[var(--drawai-border)] px-3 py-1 hover:bg-[var(--drawai-bg)]"
        onClick={() => void dismissLegacyImport()}
      >
        Not now
      </button>
    </div>
  )
}
