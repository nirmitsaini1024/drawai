import type { TLDefaultColorStyle, TLDefaultSizeStyle, TLShape } from 'tldraw'
import type { PresetKind } from '../library/presetKinds'

export const ICON_SHAPE_TYPE = 'icon' as const

/** Stroke multipliers for icon SVG paths (viewBox 0–64). */
export const ICON_STROKE_SIZES: Record<TLDefaultSizeStyle, number> = {
  s: 1.25,
  m: 2.25,
  l: 3.5,
  xl: 5,
}

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [ICON_SHAPE_TYPE]: {
      kind: PresetKind | string
      w: number
      h: number
      label: string
      color: TLDefaultColorStyle
      size: TLDefaultSizeStyle
    }
  }
}

export type IconShape = TLShape<typeof ICON_SHAPE_TYPE>
