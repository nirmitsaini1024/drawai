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
import {
  formatRefusalMessage,
  isRefusedPayload,
  parseRateLimitHeaders,
  type AiApiError,
} from './guardrails'
import { useAiRateLimitStore } from '../store/aiRateLimitStore'

const DEFAULT_BASE = 'http://localhost:8000'

export function apiBaseUrl(): string {
  // An explicitly empty VITE_API_BASE_URL means "same origin" (the Docker/nginx setup).
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined
  return configured === undefined ? DEFAULT_BASE : configured.replace(/\/$/, '')
}

export class AiRefusalError extends Error {
  readonly refused = true as const
  constructor(message: string) {
    super(message)
    this.name = 'AiRefusalError'
  }
}

export class AiRateLimitError extends Error {
  readonly status = 429
  readonly code = 'rate_limited'
  readonly retryAfterSeconds: number
  constructor(message: string, retryAfterSeconds: number) {
    super(message)
    this.name = 'AiRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function readError(res: Response, data: unknown): Promise<string> {
  if (data && typeof data === 'object') {
    if ('message' in data && typeof (data as { message: unknown }).message === 'string') {
      return (data as { message: string }).message
    }
    if ('detail' in data) {
      const detail = (data as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
      return JSON.stringify(detail)
    }
  }
  return `Request failed (${res.status})`
}

function applyLimitHeaders(res: Response) {
  const info = parseRateLimitHeaders(res)
  useAiRateLimitStore.getState().applyFromHeaders(info)
  return info
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => ({}))
  const info = applyLimitHeaders(res)

  if (res.status === 429) {
    const retry =
      (data &&
        typeof data === 'object' &&
        typeof (data as { retry_after_seconds?: unknown }).retry_after_seconds === 'number'
        ? (data as { retry_after_seconds: number }).retry_after_seconds
        : info?.retryAfterSeconds) || 60
    useAiRateLimitStore.getState().applyRateLimited(retry, info)
    const msg = await readError(res, data)
    throw new AiRateLimitError(msg || 'Too many AI requests', retry)
  }

  if (isRefusedPayload(data)) {
    throw new AiRefusalError(formatRefusalMessage(data.message))
  }

  if (!res.ok) {
    const err = new Error(await readError(res, data)) as AiApiError
    err.status = res.status
    throw err
  }
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

export function isAiRefusal(err: unknown): err is AiRefusalError {
  return err instanceof AiRefusalError || (!!err && typeof err === 'object' && (err as AiApiError).refused === true)
}

export function isAiRateLimit(err: unknown): err is AiRateLimitError {
  return err instanceof AiRateLimitError
}
