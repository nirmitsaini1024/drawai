/** Shared AI guardrail constants and client-side cooldown (mirrors server; not security). */

export const MAX_PROMPT_CHARS = 800
export const RATE_LIMIT_PER_MINUTE = 5
/** Client-side cooldown between submits (ms). Soft mirror of server limit. */
export const CLIENT_COOLDOWN_MS = Math.ceil(60_000 / RATE_LIMIT_PER_MINUTE)

export const REFUSAL_EXAMPLES = [
  'flowchart for user signup',
  '3-tier web architecture',
  'ER diagram for a blog',
] as const

export const REFUSAL_PREFIX = 'I can only create and edit diagrams. Try:'

export type RateLimitInfo = {
  limit: number
  remaining: number
  resetAt: number // unix seconds
  retryAfterSeconds: number
}

export type AiApiError = Error & {
  status?: number
  code?: string
  refused?: boolean
  rateLimit?: RateLimitInfo
  retryAfterSeconds?: number
}

export function isRefusedPayload(data: unknown): data is { refused: true; message?: string } {
  return (
    !!data &&
    typeof data === 'object' &&
    'refused' in data &&
    (data as { refused: unknown }).refused === true
  )
}

export function parseRateLimitHeaders(res: Response): RateLimitInfo | null {
  const limit = Number(res.headers.get('X-RateLimit-Limit'))
  const remaining = Number(res.headers.get('X-RateLimit-Remaining'))
  const resetAt = Number(res.headers.get('X-RateLimit-Reset'))
  const retryAfter = Number(res.headers.get('Retry-After'))
  if (!Number.isFinite(limit)) return null
  return {
    limit,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    resetAt: Number.isFinite(resetAt) ? resetAt : Math.floor(Date.now() / 1000) + 60,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 0,
  }
}

export function formatRefusalMessage(serverMessage?: string): string {
  if (serverMessage && serverMessage.includes('Try:')) return serverMessage
  const chips = REFUSAL_EXAMPLES.map((e) => `"${e}"`).join(', ')
  return `${REFUSAL_PREFIX} ${chips}`
}
