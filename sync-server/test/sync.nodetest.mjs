/**
 * Sync server tests (run: npm run test:sync). Uses an in-memory fake store and real
 * WebSocket clients speaking the tldraw sync protocol - no Postgres required.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getTlsyncProtocolVersion } from '@tldraw/sync-core'
import WebSocket from 'ws'
import { hashToken } from '../db.mjs'
import { createSyncServer } from '../server.mjs'
import { roomSchema } from '../schema.mjs'

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const EDIT_TOKEN = 'edit-token-edit-token-edit-token-0001'
const VIEW_TOKEN = 'view-token-view-token-view-token-0002'
const REVOKED_TOKEN = 'revoked-token-revoked-token-000003'
const OTHER_BOARD_TOKEN = 'other-token-other-token-other-token04'
const SLOW_BOARD_ID = '33333333-3333-4333-8333-333333333333'
const SLOW_TOKEN = 'slow-token-slow-token-slow-token-0005'

function makeStore() {
  const links = new Map()
  const add = (id, token, role, boardId = BOARD_ID, revokedAt = null) =>
    links.set(hashToken(token), { id, boardId, role, revokedAt, tokenHash: hashToken(token) })
  add('link-edit', EDIT_TOKEN, 'edit')
  add('link-view', VIEW_TOKEN, 'view')
  add('link-revoked', REVOKED_TOKEN, 'edit', BOARD_ID, new Date())
  add('link-other', OTHER_BOARD_TOKEN, 'edit', '22222222-2222-4222-8222-222222222222')
  add('link-slow', SLOW_TOKEN, 'edit', SLOW_BOARD_ID)

  return {
    saves: [],
    revokedIds: new Set(),
    loadDelayMs: 0,
    async ping() {
      return true
    },
    async findLinkByTokenHash(h) {
      return links.get(h) ?? null
    },
    async revokedLinkIds(ids) {
      return new Set(ids.filter((id) => this.revokedIds.has(id)))
    },
    async loadRoomSnapshot() {
      if (this.loadDelayMs) await new Promise((r) => setTimeout(r, this.loadDelayMs))
      return null
    },
    async loadBoardSeed() {
      return null
    },
    async saveRoom(roomId, boardId, snapshot) {
      this.saves.push({ roomId, boardId, snapshot })
    },
  }
}

function pageRecord(id) {
  return { id, typeName: 'page', name: id, index: 'a2', meta: {} }
}

/** Open a socket, send `connect`, and resolve once the server answers. */
function connectClient(port, roomId, token, sessionId) {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ sessionId })
    if (token) q.set('token', token)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/connect/${roomId}?${q}`)
    const messages = []
    const client = {
      ws,
      messages,
      closed: null,
      push(diff) {
        ws.send(JSON.stringify({ type: 'push', clientClock: ++client.clock, diff }))
      },
      clock: 0,
    }
    ws.on('close', (code) => (client.closed = code))
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data))
      messages.push(msg)
      if (msg.type === 'connect') resolve(client)
    })
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })))
    ws.on('error', reject)
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'connect',
          connectRequestId: `req-${sessionId}`,
          lastServerClock: 0,
          protocolVersion: getTlsyncProtocolVersion(),
          schema: roomSchema.serialize(),
        }),
      ),
    )
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function hasRecord(sync, id) {
  const snap = sync.manager.getRoom(BOARD_ID)?.getCurrentSnapshot()
  return !!snap?.documents.some((d) => d.state.id === id)
}

describe('sync server', () => {
  let store, sync, port

  before(async () => {
    store = makeStore()
    sync = createSyncServer({
      store,
      saveDebounceMs: 60,
      revocationPollMs: 10_000, // tests trigger the check manually
      log: { log() {}, warn() {}, error() {} },
    })
    port = await sync.listen(0, '127.0.0.1')
  })

  after(async () => {
    await sync.close()
  })

  test('rejects missing, unknown and wrong-room tokens', async () => {
    await assert.rejects(connectClient(port, BOARD_ID, null, 's-none'), { status: 401 })
    await assert.rejects(connectClient(port, BOARD_ID, 'z'.repeat(40), 's-bad'), { status: 401 })
    await assert.rejects(connectClient(port, BOARD_ID, OTHER_BOARD_TOKEN, 's-other'), { status: 401 })
  })

  test('rejects revoked links on connect', async () => {
    await assert.rejects(connectClient(port, BOARD_ID, REVOKED_TOKEN, 's-revoked'), { status: 401 })
  })

  test('edit clients can write; view-only clients cannot (server-enforced)', async () => {
    const viewer = await connectClient(port, BOARD_ID, VIEW_TOKEN, 's-view')
    const editor = await connectClient(port, BOARD_ID, EDIT_TOKEN, 's-edit')

    // The view-only client tries to add a page. The server must ignore it.
    viewer.push({ 'page:from-viewer': ['put', pageRecord('page:from-viewer')] })
    await sleep(150)
    assert.equal(hasRecord(sync, 'page:from-viewer'), false, 'view-only write must be dropped')

    // Control: the editor's identical write is applied.
    editor.push({ 'page:from-editor': ['put', pageRecord('page:from-editor')] })
    await sleep(150)
    assert.equal(hasRecord(sync, 'page:from-editor'), true, 'edit write must be applied')

    // The viewer still receives the editor's change (read access works).
    const sawIt = viewer.messages.some((m) => JSON.stringify(m).includes('page:from-editor'))
    assert.ok(sawIt, 'view-only client should receive live updates')

    // Debounced persistence happened, with the right ids.
    await sleep(200)
    assert.ok(store.saves.length >= 1)
    assert.equal(store.saves.at(-1).roomId, BOARD_ID)
    assert.equal(store.saves.at(-1).boardId, BOARD_ID)

    viewer.ws.close()
    editor.ws.close()
    await sleep(100)
  })

  test('skips saving when nothing changed, and flushes on last disconnect', async () => {
    const before = store.saves.length
    const idle = await connectClient(port, BOARD_ID, VIEW_TOKEN, 's-idle')
    await sleep(250) // longer than the debounce
    assert.equal(store.saves.length, before, 'no changes -> no save')
    idle.ws.close()
    await sleep(100)
    assert.equal(store.saves.length, before, 'closing an unchanged room must not save')

    // A change followed immediately by disconnect is flushed without waiting for the debounce.
    const editor = await connectClient(port, BOARD_ID, EDIT_TOKEN, 's-edit-2')
    editor.push({ 'page:flush-me': ['put', pageRecord('page:flush-me')] })
    await sleep(15)
    editor.ws.close()
    await sleep(150)
    assert.ok(store.saves.length > before, 'last disconnect flushes pending changes')
    const last = store.saves.at(-1).snapshot
    assert.ok(last.documents.some((d) => d.state.id === 'page:flush-me'))
  })

  test('a connect message sent before the room finishes loading is not lost', async () => {
    // A room that has never been opened must load from the (slow) store while the
    // client's `connect` message is already in flight.
    store.loadDelayMs = 200
    const slowLoad = await Promise.race([
      connectClient(port, SLOW_BOARD_ID, SLOW_TOKEN, 's-slow'),
      sleep(3000).then(() => 'timeout'),
    ])
    store.loadDelayMs = 0
    assert.notEqual(slowLoad, 'timeout', 'handshake must complete even if the room loads slowly')
    slowLoad.ws.close()
    await sleep(100)
  })

  test('closes live sockets when a link is revoked', async () => {
    const viewer = await connectClient(port, BOARD_ID, VIEW_TOKEN, 's-view-revoke')
    store.revokedIds.add('link-view')
    await sync.manager.closeRevoked()
    await sleep(100)
    assert.equal(viewer.closed, 4401)
    store.revokedIds.delete('link-view')
  })
})
