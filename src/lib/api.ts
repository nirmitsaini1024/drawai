import { apiBaseUrl } from '../ai/api'

/** HTTP-level failure from the DrawAI API. `status === 0` means the network/server was unreachable. */
export class ApiError extends Error {
  status: number
  code: string
  body: unknown

  constructor(status: number, code: string, message: string, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/** True when the failure means "can't reach the server" (so we should queue and retry). */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || [502, 503, 504].includes(err.status)
  return false
}

const TIMEOUT_MS = 20_000

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${apiBaseUrl()}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch {
    throw new ApiError(0, 'network', 'Server unreachable')
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const obj = (data && typeof data === 'object' ? data : {}) as { detail?: unknown; code?: unknown }
    throw new ApiError(
      res.status,
      typeof obj.code === 'string' ? obj.code : `http_${res.status}`,
      typeof obj.detail === 'string' ? obj.detail : `Request failed (${res.status})`,
      data,
    )
  }
  return data as T
}

// ---- Boards -----------------------------------------------------------------

export type ServerBoardMeta = { id: string; name: string; created_at: string; updated_at: string }
export type ServerBoard = ServerBoardMeta & { snapshot: unknown | null }

export const listBoards = () => request<ServerBoardMeta[]>('GET', '/boards')
export const getBoard = (id: string) => request<ServerBoard>('GET', `/boards/${id}`)
export const createBoardOnServer = (body: { id: string; name: string; snapshot: unknown | null }) =>
  request<ServerBoard>('POST', '/boards', body)
export const updateBoardOnServer = (
  id: string,
  body: { name?: string; snapshot?: unknown | null; expected_updated_at?: string | null },
) => request<ServerBoard>('PUT', `/boards/${id}`, body)
export const deleteBoardOnServer = (id: string) => request<void>('DELETE', `/boards/${id}`)

// ---- Library ----------------------------------------------------------------

export type ServerLibraryShape = {
  id: string
  name: string
  category: string
  content: unknown
  thumbnail: string
  created_at: string
  updated_at: string
}

export const listLibraryOnServer = () => request<ServerLibraryShape[]>('GET', '/library')
export const createLibraryShapeOnServer = (body: {
  id: string
  name: string
  category: string
  content: unknown
  thumbnail: string
  created_at: string
}) => request<ServerLibraryShape>('POST', '/library', body)
export const updateLibraryShapeOnServer = (
  id: string,
  body: { name?: string; category?: string; content?: unknown; thumbnail?: string },
) => request<ServerLibraryShape>('PUT', `/library/${id}`, body)
export const deleteLibraryShapeOnServer = (id: string) => request<void>('DELETE', `/library/${id}`)

// ---- Sharing ----------------------------------------------------------------

export type ShareRole = 'edit' | 'view'
export type ShareLink = {
  id: string
  board_id: string
  role: ShareRole
  created_at: string
  revoked_at: string | null
}
export type ShareLinkCreated = ShareLink & { token: string; room_id: string }
export type ResolvedRoom = { room_id: string; board_id: string; role: ShareRole; link_id: string }

export const createShareLink = (boardId: string, role: ShareRole) =>
  request<ShareLinkCreated>('POST', `/boards/${boardId}/share`, { role })
export const listShareLinks = (boardId: string) =>
  request<ShareLink[]>('GET', `/boards/${boardId}/share`)
export const revokeShareLink = (linkId: string) => request<void>('DELETE', `/share/${linkId}`)
export const rotateShareLink = (linkId: string) =>
  request<ShareLinkCreated>('POST', `/share/${linkId}/rotate`)
export const resolveRoom = (token: string) =>
  request<ResolvedRoom>('GET', `/rooms/resolve?token=${encodeURIComponent(token)}`)
