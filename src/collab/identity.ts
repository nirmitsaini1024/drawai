/**
 * Per-browser collaborator identity (Excalidraw-style).
 *
 * Stored in localStorage so each browser/profile on the same IP/domain gets its
 * own id + display name + cursor color. Different machines never share storage,
 * so same-office / same-IP users still appear as separate people.
 */

const STORAGE_KEY = 'drawai-collab'
const LEGACY_SESSION_KEY = 'drawai.collab.identity'

const ADJECTIVES = [
  'Swift',
  'Calm',
  'Bright',
  'Lucky',
  'Quiet',
  'Bold',
  'Keen',
  'Warm',
  'Cool',
  'Clear',
]

const NOUNS = [
  'Fox',
  'Owl',
  'Lynx',
  'Hawk',
  'Bear',
  'Wolf',
  'Fern',
  'Oak',
  'River',
  'Stone',
]

const COLORS = [
  '#E03131',
  '#F76707',
  '#F59F00',
  '#74B816',
  '#12B886',
  '#15AABF',
  '#228BE6',
  '#4C6EF5',
  '#7950F2',
  '#BE4BDB',
]

export type CollabIdentity = {
  /** Stable browser id — never derived from IP. */
  id: string
  name: string
  color: string
}

type Listener = (identity: CollabIdentity) => void

const listeners = new Set<Listener>()
let cached: CollabIdentity | null = null

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

function randomName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`
}

function createIdentity(): CollabIdentity {
  return {
    id: crypto.randomUUID(),
    name: randomName(),
    color: pick(COLORS),
  }
}

function readRaw(storage: Storage, key: string): Partial<CollabIdentity> | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Excalidraw shape: { username } — also accept our { id, name, color }.
    const name =
      typeof parsed.name === 'string'
        ? parsed.name
        : typeof parsed.username === 'string'
          ? parsed.username
          : undefined
    return {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      name,
      color: typeof parsed.color === 'string' ? parsed.color : undefined,
    }
  } catch {
    return null
  }
}

function persist(identity: CollabIdentity) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: identity.id, name: identity.name, color: identity.color }),
    )
  } catch {
    /* private mode / quota */
  }
}

function normalize(partial: Partial<CollabIdentity> | null): CollabIdentity | null {
  if (!partial?.id || !partial.name || !partial.color) return null
  const name = partial.name.trim().slice(0, 32)
  if (!name) return null
  return { id: partial.id, name, color: partial.color }
}

function loadIdentity(): CollabIdentity {
  const fromLocal = normalize(readRaw(localStorage, STORAGE_KEY))
  if (fromLocal) return fromLocal

  // One-time migrate from the earlier per-tab sessionStorage key.
  const fromSession = normalize(readRaw(sessionStorage, LEGACY_SESSION_KEY))
  if (fromSession) {
    persist(fromSession)
    try {
      sessionStorage.removeItem(LEGACY_SESSION_KEY)
    } catch {
      /* ignore */
    }
    return fromSession
  }

  const next = createIdentity()
  persist(next)
  return next
}

/** Stable for this browser/profile (localStorage). Safe to call often. */
export function getCollabIdentity(): CollabIdentity {
  if (!cached) cached = loadIdentity()
  return cached
}

export function setCollabUsername(name: string): CollabIdentity {
  const trimmed = name.trim().slice(0, 32) || randomName()
  const prev = getCollabIdentity()
  const next: CollabIdentity = { ...prev, name: trimmed }
  cached = next
  persist(next)
  for (const listener of listeners) listener(next)
  return next
}

/** Subscribe to display-name / color changes (e.g. while live). */
export function subscribeCollabIdentity(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
