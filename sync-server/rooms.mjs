/**
 * Room lifecycle on top of tldraw's TLSocketRoom:
 *  - load the snapshot from the store when a room opens (seeding from the board if it is new)
 *  - persist debounced after changes, skipping saves when nothing changed
 *  - flush on last disconnect
 *  - enforce view-only on the server (isReadonly) and close sockets of revoked links
 */
import { timingSafeEqual } from 'node:crypto'
import { InMemorySyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import { hashToken } from './db.mjs'

const noop = () => {}

/** Look up a share token and verify it grants access to this room. Returns the link or null. */
export async function authorizeToken(store, roomId, token) {
  if (!token || typeof token !== 'string' || token.length < 16 || token.length > 256) return null
  const candidate = hashToken(token)
  const link = await store.findLinkByTokenHash(candidate)
  if (!link) return null

  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(String(link.tokenHash ?? candidate), 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (link.revokedAt) return null
  if (String(link.boardId) !== String(roomId)) return null
  return link
}

export function createRoomManager({
  store,
  schema,
  saveDebounceMs = 2000,
  revocationPollMs = 3000,
  log = { info: noop, warn: noop, error: noop },
}) {
  /** @type {Map<string, any>} */
  const entries = new Map()
  /** @type {Map<string, {linkId: string, socket: any, roomId: string}>} */
  const sessions = new Map()

  async function flush(entry) {
    // Serialize flushes per room so snapshots are written in order.
    entry.flushing = entry.flushing.then(async () => {
      if (!entry.dirty) return
      entry.dirty = false
      clearTimeout(entry.timer)
      entry.timer = null
      try {
        await store.saveRoom(entry.roomId, entry.boardId, entry.room.getCurrentSnapshot())
        log.info(`[sync] saved room ${entry.roomId}`)
      } catch (err) {
        entry.dirty = true // retry on the next change / disconnect
        log.error(`[sync] save failed for room ${entry.roomId}: ${err?.message || err}`)
      }
    })
    return entry.flushing
  }

  function scheduleSave(entry) {
    entry.dirty = true
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void flush(entry), saveDebounceMs)
    entry.timer.unref?.()
  }

  async function closeEntry(entry) {
    entry.closing = true
    await flush(entry)
    entry.room.close()
    if (entries.get(entry.roomId) === entry) entries.delete(entry.roomId)
    entry.closedResolve()
    log.info(`[sync] closed room ${entry.roomId}`)
  }

  async function open(roomId, boardId) {
    const existing = entries.get(roomId)
    if (existing) {
      if (existing.closing) {
        await existing.closed
        return open(roomId, boardId)
      }
      await existing.ready
      return existing
    }

    const entry = {
      roomId,
      boardId,
      room: null,
      dirty: false,
      timer: null,
      closing: false,
      flushing: Promise.resolve(),
    }
    entry.closed = new Promise((resolve) => (entry.closedResolve = resolve))
    entry.ready = (async () => {
      let ready = false
      const storage = new InMemorySyncStorage({
        onChange() {
          if (ready) scheduleSave(entry)
        },
      })
      entry.room = new TLSocketRoom({
        schema,
        storage,
        onSessionRemoved(_room, args) {
          sessions.delete(args.sessionId)
          log.info(`[sync] leave ${roomId} left=${args.numSessionsRemaining}`)
          if (args.numSessionsRemaining === 0) {
            void closeEntry(entry).catch((err) => log.error(`[sync] close failed: ${err?.message || err}`))
          }
        },
      })

      const stored = await store.loadRoomSnapshot(roomId)
      let seeded = false
      try {
        if (stored) {
          entry.room.loadSnapshot(stored)
        } else if (boardId) {
          const seed = await store.loadBoardSeed(boardId)
          if (seed) {
            entry.room.loadSnapshot(seed)
            seeded = true
          }
        }
      } catch (err) {
        log.warn(`[sync] could not load snapshot for ${roomId}: ${err?.message || err}`)
      }
      ready = true
      if (seeded) scheduleSave(entry) // create the rooms row for a new room
      log.info(`[sync] open room ${roomId}${stored ? ' (restored)' : seeded ? ' (seeded)' : ''}`)
    })()
    entries.set(roomId, entry)
    try {
      await entry.ready
    } catch (err) {
      entries.delete(roomId)
      throw err
    }
    return entry
  }

  /** Attach an authenticated socket. Role comes from the DB link, never from the client. */
  async function attach({ roomId, link, sessionId, socket }) {
    const entry = await open(roomId, link.boardId ? String(link.boardId) : null)
    const isReadonly = link.role !== 'edit' // fail closed: anything but "edit" is read-only
    sessions.set(sessionId, { linkId: link.id, socket, roomId })
    entry.room.handleSocketConnect({ sessionId, socket, isReadonly })
    log.info(`[sync] join ${roomId} link=${String(link.id).slice(0, 8)} readonly=${isReadonly}`)
    return { entry, isReadonly }
  }

  async function closeRevoked() {
    const linkIds = [...new Set([...sessions.values()].map((s) => s.linkId))]
    if (linkIds.length === 0) return
    let revoked
    try {
      revoked = await store.revokedLinkIds(linkIds)
    } catch (err) {
      log.warn(`[sync] revocation check failed: ${err?.message || err}`)
      return
    }
    if (revoked.size === 0) return
    for (const [sessionId, s] of sessions) {
      if (revoked.has(s.linkId)) {
        log.info(`[sync] closing session of revoked link ${String(s.linkId).slice(0, 8)}`)
        sessions.delete(sessionId)
        try {
          s.socket.close(4401, 'link revoked')
        } catch {
          /* socket already gone */
        }
      }
    }
  }

  const poller = setInterval(() => void closeRevoked(), revocationPollMs)
  poller.unref?.()

  async function close() {
    clearInterval(poller)
    await Promise.all([...entries.values()].map((e) => closeEntry(e).catch(() => {})))
  }

  return {
    attach,
    close,
    closeRevoked, // exposed for tests
    stats: () => ({ rooms: entries.size, sessions: sessions.size }),
    getRoom: (roomId) => entries.get(roomId)?.room ?? null,
  }
}
