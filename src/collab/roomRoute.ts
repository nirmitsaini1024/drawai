export type CollabRoute = { mode: 'local' } | { mode: 'collab'; token: string }

// Share links look like  #/s/<unguessable token>  (>= 256 bits, URL-safe base64).
const SHARE_RE = /^#\/s\/([A-Za-z0-9_-]{16,256})\/?$/

export function parseCollabRoute(hash = window.location.hash): CollabRoute {
  const m = SHARE_RE.exec(hash)
  return m ? { mode: 'collab', token: m[1]! } : { mode: 'local' }
}

export function shareHash(token: string): string {
  return `#/s/${token}`
}

export function shareUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}${shareHash(token)}`
}

/**
 * WebSocket base for the sync server (without room id).
 *  - VITE_SYNC_WS_URL unset  -> local dev default (ws://localhost:8787/connect)
 *  - VITE_SYNC_WS_URL empty  -> same origin (Docker/nginx proxies /connect to the sync service)
 */
export function syncWsBase(): string {
  const configured = import.meta.env.VITE_SYNC_WS_URL as string | undefined
  if (configured === undefined) return 'ws://localhost:8787/connect'
  if (configured === '') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/connect`
  }
  return configured.replace(/\/$/, '')
}
