import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  formatRefusalMessage,
  isRefusedPayload,
  MAX_PROMPT_CHARS,
  parseRateLimitHeaders,
  REFUSAL_EXAMPLES,
} from './guardrails'
import { useAiRateLimitStore } from '../store/aiRateLimitStore'

describe('guardrails helpers', () => {
  test('isRefusedPayload', () => {
    expect(isRefusedPayload({ refused: true, message: 'nope' })).toBe(true)
    expect(isRefusedPayload({ nodes: [] })).toBe(false)
    expect(isRefusedPayload(null)).toBe(false)
  })

  test('formatRefusalMessage includes examples', () => {
    const msg = formatRefusalMessage()
    expect(msg).toContain('I can only create and edit diagrams')
    for (const ex of REFUSAL_EXAMPLES) {
      expect(msg).toContain(ex)
    }
  })

  test('parseRateLimitHeaders', () => {
    const res = new Response(null, {
      headers: {
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '3',
        'X-RateLimit-Reset': '1700000060',
        'Retry-After': '23',
      },
    })
    const info = parseRateLimitHeaders(res)
    expect(info).toEqual({
      limit: 5,
      remaining: 3,
      resetAt: 1700000060,
      retryAfterSeconds: 23,
    })
  })

  test('MAX_PROMPT_CHARS is 800', () => {
    expect(MAX_PROMPT_CHARS).toBe(800)
  })
})

describe('aiRateLimitStore countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAiRateLimitStore.setState({
      remaining: 5,
      limit: 5,
      retryUntil: null,
      lastSubmitAt: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('applyRateLimited disables submit until countdown ends', () => {
    const store = useAiRateLimitStore.getState()
    store.applyRateLimited(23, { limit: 5, remaining: 0, resetAt: 0, retryAfterSeconds: 23 })
    expect(useAiRateLimitStore.getState().canSubmit()).toBe(false)
    expect(useAiRateLimitStore.getState().secondsUntilRetry()).toBe(23)

    vi.advanceTimersByTime(23_000)
    expect(useAiRateLimitStore.getState().secondsUntilRetry()).toBe(0)
    useAiRateLimitStore.getState().clearRetry()
    expect(useAiRateLimitStore.getState().canSubmit()).toBe(true)
  })

  test('client cooldown mirrors soft limit', () => {
    useAiRateLimitStore.getState().noteClientSubmit()
    expect(useAiRateLimitStore.getState().canSubmit()).toBe(false)
    vi.advanceTimersByTime(12_000)
    expect(useAiRateLimitStore.getState().canSubmit()).toBe(true)
  })

  test('remaining hint from headers', () => {
    useAiRateLimitStore.getState().applyFromHeaders({
      limit: 5,
      remaining: 3,
      resetAt: 1,
      retryAfterSeconds: 0,
    })
    expect(useAiRateLimitStore.getState().remaining).toBe(3)
    expect(useAiRateLimitStore.getState().limit).toBe(5)
  })
})
