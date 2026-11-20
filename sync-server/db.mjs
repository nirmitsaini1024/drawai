/**
 * Postgres access for the sync server. All queries are parameterized.
 * Tables are created/owned by the API's Alembic migrations (server/alembic).
 */
import { createHash } from 'node:crypto'
import pg from 'pg'

export function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex')
}

/** Accept the API's SQLAlchemy-style URL too (postgresql+asyncpg://...). */
export function normalizeDatabaseUrl(url) {
  return String(url).replace(/^postgres(ql)?\+\w+:\/\//, 'postgresql://')
}

export function createPool(databaseUrl) {
  return new pg.Pool({
    connectionString: normalizeDatabaseUrl(databaseUrl),
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
  })
}

/** Builds the store interface used by the room manager (so tests can swap in a fake). */
export function createPgStore(pool) {
  return {
    async ping() {
      await pool.query('SELECT 1')
      return true
    },

    /** @returns {{id, boardId, role, revokedAt} | null} */
    async findLinkByTokenHash(tokenHash) {
      const { rows } = await pool.query(
        `SELECT l.id, l.board_id, l.role::text AS role, l.revoked_at, l.token_hash
           FROM room_links l
           JOIN boards b ON b.id = l.board_id AND b.deleted_at IS NULL
          WHERE l.token_hash = $1`,
        [tokenHash],
      )
      const r = rows[0]
      if (!r) return null
      return {
        id: r.id,
        boardId: r.board_id,
        role: r.role,
        revokedAt: r.revoked_at,
        tokenHash: r.token_hash,
      }
    },

    /** Of the given link ids, which are revoked (or whose board is gone)? */
    async revokedLinkIds(linkIds) {
      if (linkIds.length === 0) return new Set()
      const { rows } = await pool.query(
        `SELECT l.id
           FROM room_links l
           LEFT JOIN boards b ON b.id = l.board_id
          WHERE l.id = ANY($1::uuid[])
            AND (l.revoked_at IS NOT NULL OR b.id IS NULL OR b.deleted_at IS NOT NULL)`,
        [linkIds],
      )
      return new Set(rows.map((r) => r.id))
    },

    async loadRoomSnapshot(roomId) {
      const { rows } = await pool.query('SELECT snapshot FROM rooms WHERE id = $1', [roomId])
      return rows[0]?.snapshot ?? null
    },

    /** The board's current document (a TLStoreSnapshot) used to seed a brand-new room. */
    async loadBoardSeed(boardId) {
      const { rows } = await pool.query(
        'SELECT snapshot FROM boards WHERE id = $1 AND deleted_at IS NULL',
        [boardId],
      )
      return rows[0]?.snapshot?.document ?? null
    },

    /**
     * Upsert the room snapshot and, when the room belongs to a board, write the
     * document back into the board so the owner sees collaborators' edits.
     */
    async saveRoom(roomId, boardId, roomSnapshot) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO rooms (id, board_id, snapshot, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
           ON CONFLICT (id) DO UPDATE
             SET snapshot = EXCLUDED.snapshot, board_id = EXCLUDED.board_id, updated_at = now()`,
          [roomId, boardId, JSON.stringify(roomSnapshot)],
        )
        if (boardId) {
          const { rows } = await client.query(
            'SELECT snapshot FROM boards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
            [boardId],
          )
          if (rows[0]) {
            const next = roomToBoardSnapshot(rows[0].snapshot, roomSnapshot)
            await client.query(
              'UPDATE boards SET snapshot = $2::jsonb, updated_at = now() WHERE id = $1',
              [boardId, JSON.stringify(next)],
            )
          }
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },

    async importRoom(roomId, snapshot) {
      await pool.query(
        `INSERT INTO rooms (id, board_id, snapshot, updated_at)
         VALUES ($1, NULL, $2::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [roomId, JSON.stringify(snapshot)],
      )
    },
  }
}

/** RoomSnapshot ({documents, schema}) -> TLEditorSnapshot, keeping the board's session state. */
export function roomToBoardSnapshot(existing, roomSnapshot) {
  const store = {}
  for (const doc of roomSnapshot.documents ?? []) {
    if (doc?.state?.id) store[doc.state.id] = doc.state
  }
  const next = { document: { store, schema: roomSnapshot.schema } }
  if (existing && typeof existing === 'object' && existing.session) next.session = existing.session
  return next
}
