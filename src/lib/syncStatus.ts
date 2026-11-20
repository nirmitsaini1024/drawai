import { create } from 'zustand'

export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error'

export type LegacyCounts = { boards: number; shapes: number }

type SyncStatusStore = {
  state: SyncState
  message: string | null
  /** Items waiting to be pushed (shown while offline). */
  pending: number
  /** Local-only data from before server sync existed; drives the import banner. */
  legacy: LegacyCounts | null
  set: (state: SyncState, message?: string | null) => void
  setPending: (pending: number) => void
  setLegacy: (legacy: LegacyCounts | null) => void
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: 'idle',
  message: null,
  pending: 0,
  legacy: null,
  set: (state, message = null) => set({ state, message }),
  setPending: (pending) => set({ pending }),
  setLegacy: (legacy) => set({ legacy }),
}))
