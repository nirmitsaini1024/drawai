import { useEffect, useState } from 'react'
import { CollabCanvas } from './collab/CollabCanvas'
import { parseCollabRoute, type CollabRoute } from './collab/roomRoute'
import { useRoomSession } from './collab/useRoomSession'
import { Canvas } from './components/Canvas'
import { CommandPalette } from './components/CommandPalette'
import { ExplainDialog } from './components/ExplainDialog'
import { ImageToDiagramDialog } from './components/ImageToDiagramDialog'
import { ImportLocalBanner } from './components/ImportLocalBanner'
import { MermaidImportDialog } from './components/MermaidImportDialog'
import { SaveAsShapeDialog } from './components/SaveAsShapeDialog'
import { ShareDialog } from './components/ShareDialog'
import { TopBar } from './components/TopBar'
import { useAppStore } from './store/appStore'
import { useLibraryStore } from './store/libraryStore'

export default function App() {
  const ready = useAppStore((s) => s.ready)
  const hydrate = useAppStore((s) => s.hydrate)
  const libraryReady = useLibraryStore((s) => s.ready)
  const hydrateLibrary = useLibraryStore((s) => s.hydrate)
  const [route, setRoute] = useState<CollabRoute>(() => parseCollabRoute())
  const token = route.mode === 'collab' ? route.token : null
  const session = useRoomSession(token)

  useEffect(() => {
    void hydrate()
    void hydrateLibrary()
  }, [hydrate, hydrateLibrary])

  useEffect(() => {
    const onHash = () => setRoute(parseCollabRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!ready || !libraryReady) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--drawai-muted)]">
        Loading DrawAI…
      </div>
    )
  }

  const ready_ = session?.status === 'ready' ? session : null

  return (
    <div className="flex h-full flex-col">
      <TopBar
        collab={
          token
            ? { token, roomId: ready_?.roomId ?? null, readonly: ready_ ? ready_.role === 'view' : true }
            : null
        }
      />
      {!token && <ImportLocalBanner />}
      {token ? (
        ready_ ? (
          <CollabCanvas roomId={ready_.roomId} token={token} readonly={ready_.role === 'view'} />
        ) : (
          <RoomStatus session={session} />
        )
      ) : (
        <Canvas />
      )}
      <SaveAsShapeDialog />
      <ImageToDiagramDialog />
      <MermaidImportDialog />
      <ExplainDialog />
      <ShareDialog />
      <CommandPalette />
    </div>
  )
}

function RoomStatus({ session }: { session: ReturnType<typeof useRoomSession> }) {
  if (session?.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-[var(--drawai-danger)]">{session.message}</p>
        <a href="#/" className="text-sm text-[var(--drawai-accent)] underline">
          Back to my boards
        </a>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--drawai-muted)]">
      Opening shared board…
    </div>
  )
}
