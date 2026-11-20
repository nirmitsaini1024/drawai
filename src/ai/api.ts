import type {
  DiagramRequest,
  EditRequest,
  EditResponse,
  ExplainRequest,
  Graph,
  ImageDiagramRequest,
  MermaidRequest,
  TextResponse,
} from './types'

const DEFAULT_BASE = 'http://localhost:8000'

export function apiBaseUrl(): string {
  // An explicitly empty VITE_API_BASE_URL means "same origin" (the Docker/nginx setup).
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined
  return configured === undefined ? DEFAULT_BASE : configured.replace(/\/$/, '')
}

async function readError(res: Response, data: unknown): Promise<string> {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    return JSON.stringify(detail)
  }
  return `Request failed (${res.status})`
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(await readError(res, data))
  return data as T
}

export function requestDiagram(body: DiagramRequest): Promise<Graph> {
  return postJson('/api/diagram', body)
}

export function requestEdit(body: EditRequest): Promise<EditResponse> {
  return postJson('/api/edit', body)
}

export function requestDiagramFromImage(body: ImageDiagramRequest): Promise<Graph> {
  return postJson('/api/diagram/from-image', body)
}

export function requestMermaid(body: MermaidRequest): Promise<Graph> {
  return postJson('/api/mermaid', body)
}

export function requestExplain(body: ExplainRequest): Promise<TextResponse> {
  return postJson('/api/explain', body)
}
