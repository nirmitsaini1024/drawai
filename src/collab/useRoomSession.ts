import { useEffect, useState } from 'react'
import { ApiError, resolveRoom, type ShareRole } from '../lib/api'

export type RoomSession =
  | { status: 'resolving' }
  | { status: 'error'; message: string }
  | { status: 'ready'; roomId: string; boardId: string; role: ShareRole; linkId: string }

/** Exchanges a share token for the room id + role via the API. `null` token = not in a room. */
export function useRoomSession(token: string | null): RoomSession | null {
  const [state, setState] = useState<{ token: string; session: RoomSession } | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    resolveRoom(token)
      .then((r) => {
        if (cancelled) return
        setState({
          token,
          session: { status: 'ready', roomId: r.room_id, boardId: r.board_id, role: r.role, linkId: r.link_id },
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message =
          err instanceof ApiError && err.status === 404
            ? 'This share link is invalid or has been revoked.'
            : 'Could not reach the server to open this link.'
        setState({ token, session: { status: 'error', message } })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (!token) return null
  return state?.token === token ? state.session : { status: 'resolving' }
}
