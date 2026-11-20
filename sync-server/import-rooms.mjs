/**
 * One-off: import legacy sync-server/.rooms/*.json snapshots into the Postgres rooms table.
 *
 *   DATABASE_URL=postgresql://… node sync-server/import-rooms.mjs [dir]
 *
 * Existing rows are never overwritten. Imported rooms have no board, so they are only
 * reachable if you attach them to a board yourself; this keeps your old data safe.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPgStore, createPool } from './db.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dir = process.argv[2] || join(here, '.rooms')
const databaseUrl = process.env.DATABASE_URL || 'postgresql://drawai:drawai@localhost:5432/drawai'

if (!existsSync(dir)) {
  console.log(`No ${dir} directory - nothing to import.`)
  process.exit(0)
}

const pool = createPool(databaseUrl)
const store = createPgStore(pool)
let imported = 0
let skipped = 0

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const roomId = file.replace(/\.json$/, '').slice(0, 64)
  try {
    const snapshot = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    await store.importRoom(roomId, snapshot)
    imported++
    console.log(`imported ${roomId}`)
  } catch (err) {
    skipped++
    console.warn(`skipped ${file}: ${err.message}`)
  }
}

await pool.end()
console.log(`Done. imported=${imported} skipped=${skipped}`)
