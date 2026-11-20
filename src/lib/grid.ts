/** Base minor cell size in page (world) pixels. */
export const GRID_BASE_MINOR = 20

/** Major grid line every N minor cells. */
export const GRID_MAJOR_EVERY = 5

/** Keep on-screen minor spacing roughly in this band. */
const SCREEN_MIN = 12
const SCREEN_MAX = 60

/** Fade / hide thresholds (screen px). */
const MINOR_FADE_START = 8
const ALL_HIDE = 4

/** Cap LOD so extreme zoom-out can still collapse the grid. */
const MAX_LEVEL = 10 // 20 * 1024
const MIN_LEVEL = -6 // 20 / 64

export type GridLevels = {
  minorSize: number
  majorSize: number
  minorOpacity: number
  majorOpacity: number
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Linear 0→1 as x goes from a→b. */
function fade(x: number, a: number, b: number): number {
  if (a === b) return x >= b ? 1 : 0
  return clamp01((x - a) / (b - a))
}

/**
 * Adaptive Miro-style grid LOD for a given camera zoom.
 * Picks a power-of-two multiple of {@link GRID_BASE_MINOR} so on-screen
 * minor spacing stays ~12–60px, and fades levels instead of hard-cutting.
 */
export function getGridLevels(zoom: number): GridLevels {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1e-6

  // Nearest power-of-two scale that lands spacing near the middle of the band.
  const targetScreen = Math.sqrt(SCREEN_MIN * SCREEN_MAX)
  const exactLevel = Math.log2(targetScreen / (GRID_BASE_MINOR * z))
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(exactLevel)))
  const minorSize = GRID_BASE_MINOR * 2 ** level
  const majorSize = minorSize * GRID_MAJOR_EVERY

  const screenMinor = minorSize * z
  const screenMajor = majorSize * z

  // Extremely zoomed out past the LOD cap: hide everything.
  if (screenMinor < ALL_HIDE) {
    return { minorSize, majorSize, minorOpacity: 0, majorOpacity: 0 }
  }

  // Major lines: fade in from ~4px toward full by ~12px.
  let majorOpacity = fade(screenMajor, ALL_HIDE, SCREEN_MIN)

  // Minor lines: hidden below ~8px, fade up to full by ~12px.
  let minorOpacity = fade(screenMinor, MINOR_FADE_START, SCREEN_MIN)

  // Soften opacities near the top of the comfortable band for smoother level changes.
  if (screenMinor > SCREEN_MAX * 0.75) {
    const highFade = fade(screenMinor, SCREEN_MAX * 0.75, SCREEN_MAX)
    minorOpacity *= 1 - highFade * 0.65
  }
  if (screenMinor < SCREEN_MIN) {
    // Already handled by fade from 8→12; keep major stronger while minor dies out.
    majorOpacity = Math.max(majorOpacity, fade(screenMinor, ALL_HIDE, MINOR_FADE_START))
  }

  if (screenMinor < MINOR_FADE_START) {
    minorOpacity = 0
  }

  return {
    minorSize,
    majorSize,
    minorOpacity: clamp01(minorOpacity),
    majorOpacity: clamp01(majorOpacity),
  }
}
