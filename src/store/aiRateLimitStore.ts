import { create } from 'zustand'
import {
  CLIENT_COOLDOWN_MS,
  RATE_LIMIT_PER_MINUTE,
  type RateLimitInfo,
} from '../ai/guardrails'

type AiRateLimitState = {
  remaining: number | null
  limit: number
  retryUntil: number | null // Date.now() ms
  lastSubmitAt: number | null
  applyFromHeaders: (info: RateLimitInfo | null) => void
  applyRateLimited: (retryAfterSeconds: number, info?: RateLimitInfo | null) => void
  noteClientSubmit: () => void
  canSubmit: () => boolean
  secondsUntilRetry: () => number
  clearRetry: () => void
}

export const useAiRateLimitStore = create<AiRateLimitState>((set, get) => ({
  remaining: null,
  limit: RATE_LIMIT_PER_MINUTE,
  retryUntil: null,
  lastSubmitAt: null,

  applyFromHeaders: (info) => {
    if (!info) return
    set({
      remaining: info.remaining,
      limit: info.limit || RATE_LIMIT_PER_MINUTE,
    })
  },

  applyRateLimited: (retryAfterSeconds, info) => {
    const until = Date.now() + Math.max(1, retryAfterSeconds) * 1000
    set({
      retryUntil: until,
      remaining: 0,
      limit: info?.limit ?? get().limit,
    })
  },

  noteClientSubmit: () => {
    set({ lastSubmitAt: Date.now() })
  },

  canSubmit: () => {
    const { retryUntil, lastSubmitAt } = get()
    const now = Date.now()
    if (retryUntil && now < retryUntil) return false
    if (lastSubmitAt && now - lastSubmitAt < CLIENT_COOLDOWN_MS) return false
    return true
  },

  secondsUntilRetry: () => {
    const { retryUntil, lastSubmitAt } = get()
    const now = Date.now()
    let wait = 0
    if (retryUntil && retryUntil > now) wait = Math.max(wait, retryUntil - now)
    if (lastSubmitAt) {
      const cool = lastSubmitAt + CLIENT_COOLDOWN_MS - now
      if (cool > 0) wait = Math.max(wait, cool)
    }
    return Math.ceil(wait / 1000)
  },

  clearRetry: () => set({ retryUntil: null }),
}))
