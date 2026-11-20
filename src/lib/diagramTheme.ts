/**
 * Design tokens for AI-generated diagrams. Pure data + helpers (no tldraw / React imports) so the
 * layout code and tests can use them too.
 */
import type { EdgeKind, Tone } from '../ai/types'

export type ColorMode = 'light' | 'dark'
export type DiagramStyle = 'clean' | 'sketch'

export const DEFAULT_DIAGRAM_STYLE: DiagramStyle = 'clean'

export type ToneColors = {
  fill: string
  stroke: string
  text: string
  /** Secondary text (descriptions). */
  muted: string
}

export const TONE_COLORS: Record<Tone, Record<ColorMode, ToneColors>> = {
  neutral: {
    light: { fill: '#F8FAFC', stroke: '#94A3B8', text: '#1E293B', muted: '#475569' },
    dark: { fill: '#262A33', stroke: '#6B7585', text: '#E8EBF0', muted: '#A9B1BF' },
  },
  primary: {
    light: { fill: '#EAF2FF', stroke: '#3B82F6', text: '#1E3A8A', muted: '#3B5BA8' },
    dark: { fill: '#18294A', stroke: '#5B9BFF', text: '#DCE9FF', muted: '#A9C4F2' },
  },
  success: {
    light: { fill: '#E7F7EE', stroke: '#22A15A', text: '#14532D', muted: '#2F6B47' },
    dark: { fill: '#12301F', stroke: '#3DC46F', text: '#D5F7E1', muted: '#9ED8B5' },
  },
  warning: {
    light: { fill: '#FFF5D9', stroke: '#D99A00', text: '#6B3A06', muted: '#855418' },
    dark: { fill: '#3A2D0E', stroke: '#F5B731', text: '#FDEDB8', muted: '#E3C77A' },
  },
  danger: {
    light: { fill: '#FDECEC', stroke: '#E5484D', text: '#7F1D1D', muted: '#9B3A3A' },
    dark: { fill: '#3D1A1C', stroke: '#FF6B70', text: '#FFDDDE', muted: '#EDA8AA' },
  },
  info: {
    light: { fill: '#F2ECFF', stroke: '#8B5CF6', text: '#4C1D95', muted: '#6D45B5' },
    dark: { fill: '#2A1F4A', stroke: '#A78BFA', text: '#EBE1FF', muted: '#C4B3F0' },
  },
}

export const FONT_STACK =
  "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

/** Handwritten family, used only in Sketch style. */
export const SKETCH_FONT_STACK = "'Shantell Sans', 'Comic Sans MS', 'Segoe Print', cursive"

export const TYPOGRAPHY = {
  label: { size: 14, weight: 500, lineHeight: 1.35 },
  description: { size: 12, weight: 400, lineHeight: 1.35 },
  edgeLabel: { size: 12, weight: 500, lineHeight: 1.3 },
  groupTitle: { size: 12, weight: 600, lineHeight: 1.3 },
} as const

export const NODE_METRICS = {
  radius: 10,
  strokeWidth: 1.5,
  padX: 24,
  padY: 16,
  maxWidth: 220,
  iconSize: 28,
  iconGap: 10,
  /** Horizontal slant of parallelogram sides. */
  skew: 14,
  /** Height of the cylinder caps. */
  cap: 10,
} as const

export const EDGE_METRICS = {
  strokeWidth: 1.5,
  labelPadX: 8,
  labelPadY: 3,
} as const

export const GROUP_METRICS = {
  paddingTop: 40,
  paddingSide: 24,
  paddingBottom: 24,
  radius: 14,
  strokeWidth: 1.25,
  tintAlpha: 0.07,
} as const

export const CANVAS_BG: Record<ColorMode, string> = {
  light: '#FFFFFF',
  dark: '#15171C',
}

export function toneColors(tone: Tone, mode: ColorMode): ToneColors {
  return TONE_COLORS[tone][mode]
}

export function fontFamilyFor(style: DiagramStyle): string {
  return style === 'sketch' ? SKETCH_FONT_STACK : FONT_STACK
}

export function nodeShadow(mode: ColorMode): string {
  return mode === 'light'
    ? 'drop-shadow(0 1px 2px rgba(15,23,42,0.12)) drop-shadow(0 2px 6px rgba(15,23,42,0.06))'
    : 'none'
}

export type EdgeColors = { stroke: string; label: string; dashed: boolean }

const EDGE_NEUTRAL: Record<ColorMode, { stroke: string; label: string }> = {
  light: { stroke: '#64748B', label: '#334155' },
  dark: { stroke: '#8A94A6', label: '#CBD2DE' },
}

/** Stroke / label colors for an edge kind ("Yes" tinted green, "No" tinted red). */
export function edgeColors(kind: EdgeKind | string | undefined, mode: ColorMode): EdgeColors {
  switch (kind) {
    case 'yes':
      return {
        stroke: TONE_COLORS.success[mode].stroke,
        label: mode === 'light' ? '#157A43' : '#6EE09A',
        dashed: false,
      }
    case 'no':
    case 'error':
      return {
        stroke: TONE_COLORS.danger[mode].stroke,
        label: mode === 'light' ? '#B42318' : '#FF9A9E',
        dashed: false,
      }
    case 'async':
      return { ...EDGE_NEUTRAL[mode], dashed: true }
    default:
      return { ...EDGE_NEUTRAL[mode], dashed: false }
  }
}

/** WCAG relative luminance contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
