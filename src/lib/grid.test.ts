import { describe, expect, it } from 'vitest'
import {
  getGridLevels,
  GRID_BASE_MINOR,
  GRID_MAJOR_EVERY,
} from './grid'

describe('getGridLevels', () => {
  it('at zoom 1 uses the base minor/major sizes with visible lines', () => {
    const levels = getGridLevels(1)
    expect(levels.minorSize).toBe(GRID_BASE_MINOR)
    expect(levels.majorSize).toBe(GRID_BASE_MINOR * GRID_MAJOR_EVERY)
    expect(levels.minorOpacity).toBeGreaterThan(0.5)
    expect(levels.majorOpacity).toBeGreaterThan(0.5)
  })

  it('doubles minor size when zooming out so screen spacing stays usable', () => {
    const levels = getGridLevels(0.4)
    // 20 * 0.4 = 8 → too tight; expect at least 40 (screen 16) or 80
    expect(levels.minorSize).toBeGreaterThanOrEqual(GRID_BASE_MINOR * 2)
    expect(levels.minorSize * 0.4).toBeGreaterThanOrEqual(12 - 0.5)
    expect(levels.minorSize * 0.4).toBeLessThanOrEqual(60 + 0.5)
    expect(levels.majorSize).toBe(levels.minorSize * GRID_MAJOR_EVERY)
  })

  it('halves minor size when zooming in so spacing does not get huge', () => {
    const levels = getGridLevels(4)
    // 20 * 4 = 80 → above 60; expect 10 (screen 40)
    expect(levels.minorSize).toBeLessThan(GRID_BASE_MINOR)
    expect(levels.minorSize * 4).toBeGreaterThanOrEqual(12)
    expect(levels.minorSize * 4).toBeLessThanOrEqual(60)
  })

  it('hides minor lines when on-screen minor spacing is below ~8px', () => {
    // Force a level whose screen minor is small by using extreme zoom-out
    // after the picker still lands near the min band edge.
    const levels = getGridLevels(0.05)
    const screenMinor = levels.minorSize * 0.05
    if (screenMinor < 8) {
      expect(levels.minorOpacity).toBe(0)
    }
    // Major should still be considered (may be faded but structure present)
    expect(levels.majorSize).toBe(levels.minorSize * GRID_MAJOR_EVERY)
  })

  it('hides the whole grid when spacing collapses below ~4px', () => {
    const levels = getGridLevels(1e-8)
    expect(levels.minorOpacity).toBe(0)
    expect(levels.majorOpacity).toBe(0)
  })

  it('fades opacities smoothly near band edges (no hard 0/1 snap at mid zoom)', () => {
    const a = getGridLevels(0.55)
    const b = getGridLevels(0.6)
    // Adjacent zooms should not jump opacity by a full unit
    expect(Math.abs(a.minorOpacity - b.minorOpacity)).toBeLessThan(0.5)
    expect(Math.abs(a.majorOpacity - b.majorOpacity)).toBeLessThan(0.5)
  })

  it('always returns finite positive sizes that are power-of-two multiples of the base', () => {
    for (const zoom of [0.1, 0.25, 0.5, 1, 2, 3, 8]) {
      const { minorSize, majorSize } = getGridLevels(zoom)
      expect(Number.isFinite(minorSize)).toBe(true)
      expect(minorSize).toBeGreaterThan(0)
      const ratio = minorSize / GRID_BASE_MINOR
      const log2 = Math.log2(ratio)
      expect(Math.abs(log2 - Math.round(log2))).toBeLessThan(1e-9)
      expect(majorSize).toBe(minorSize * GRID_MAJOR_EVERY)
    }
  })

  it('treats non-positive zoom as a tiny positive zoom', () => {
    const levels = getGridLevels(0)
    expect(levels.minorOpacity).toBe(0)
    expect(levels.majorOpacity).toBe(0)
  })
})
