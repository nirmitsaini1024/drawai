/**
 * DrawAI multiplayer sync server (tldraw TLSocketRoom + ws), persisted in Postgres.
 *
 * Connect:  ws://host:8787/connect/:roomId?sessionId=…&token=<share token>
 * Health:   GET /health   (checks the database)
 *
 * Access is decided only by the share token in room_links:
 *   role "edit" -> read/write, role "view" -> isReadonly (server-enforced),
 *   revoked links are rejected on connect and live sockets are closed.
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { createPgStore, createPool } from './db.mjs'
import { authorizeToken, createRoomManager } from './rooms.mjs'
import { roomSchema } from './schema.mjs'

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function reject(socket, status, text) {
  if (socket.destroyed) return
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

export function createSyncServer({
  store,
  schema = roomSchema,
  saveDebounceMs = Number(process.env.SYNC_SAVE_DEBOUNCE_MS || 2000),
  revocationPollMs = Number(process.env.SYNC_REVOCATION_POLL_MS || 3000),
  log = console,
} = {}) {
  const manager = createRoomManager({
    store,
    schema,
    saveDebounceMs,
    revocationPollMs,
    log: { info: (m) => log.log?.(m), warn: (m) => log.warn?.(m), error: (m) => log.error?.(m) },
  })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname === '/health') {
      let db = 'ok'
      try {
        await store.ping()
      } catch {
        db = 'down'
      }
      res.writeHead(db === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: db === 'ok' ? 'ok' : 'degraded', db, ...manager.stats() }))
      return
    }
    res.writeHead(404)
    res.end('Not found')
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      const match = url.pathname.match(/^\/connect\/([^/]+)$/)
      if (!match) return reject(socket, 404, 'Not Found')

      const roomId = decodeURIComponent(match[1])
      const sessionId = url.searchParams.get('sessionId')
      const token = url.searchParams.get('token')
      if (!ROOM_ID_RE.test(roomId) || !sessionId || sessionId.length > 128) {
        return reject(socket, 400, 'Bad Request')
      }

      const link = await authorizeToken(store, roomId, token)
      if (!link) return reject(socket, 401, 'Unauthorized')
      if (socket.destroyed) return

      wss.handleUpgrade(req, socket, head, (ws) => {
        // Clients send their `connect` message as soon as the socket opens, but attaching
        // is async (the room may still be loading from Postgres). `ws` drops messages that
        // arrive with no listener, so buffer them and replay once tldraw has subscribed.
        const early = []
        const bufferEarly = (data, isBinary) => early.push([data, isBinary])
        ws.on('message', bufferEarly)

        manager
          .attach({ roomId, link, sessionId, socket: ws })
          .then(() => {
            ws.off('message', bufferEarly)
            for (const [data, isBinary] of early) ws.emit('message', data, isBinary)
          })
          .catch((err) => {
            log.error?.(`[sync] connect failed: ${err?.message || err}`)
            ws.close(1011, 'server error')
          })
      })
    } catch (err) {
      log.error?.(`[sync] upgrade error: ${err?.message || err}`)
      reject(socket, 500, 'Internal Server Error')
    }
  })

  return {
    server,
    manager,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address().port))
      }),
    async close() {
      await manager.close()
      for (const client of wss.clients) client.terminate()
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://drawai:drawai@localhost:5432/drawai'
  const port = Number(process.env.SYNC_PORT || 8787)
  const pool = createPool(databaseUrl)
  pool.on('error', (err) => console.error('[sync] pg pool error', err.message))

  const sync = createSyncServer({ store: createPgStore(pool) })
  const actual = await sync.listen(port)
  console.log(`[sync] DrawAI sync server on :${actual}`)
  console.log('[sync] WS  /connect/:roomId?sessionId=…&token=…')

  const shutdown = async (signal) => {
    console.log(`[sync] ${signal}: flushing rooms…`)
    await sync.close().catch(() => {})
    await pool.end().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
