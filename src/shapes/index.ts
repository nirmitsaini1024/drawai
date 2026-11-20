import { DEFAULT_THEME, defaultShapeUtils, type TLThemes } from 'tldraw'
import { FONT_STACK } from '../lib/diagramTheme'
import { DiagramArrowShapeUtil } from './DiagramArrowShapeUtil'
import { DiagramGroupShapeUtil, DiagramNodeShapeUtil } from './DiagramShapeUtils'
import { IconShapeUtil } from './IconShapeUtil'

export const customShapeUtils = [
  IconShapeUtil,
  DiagramNodeShapeUtil,
  DiagramGroupShapeUtil,
  DiagramArrowShapeUtil,
]

/** Shape utils for building a sync schema (defaults minus the arrow we replace). */
export const syncShapeUtils = [
  ...defaultShapeUtils.filter((u) => u.type !== 'arrow'),
  ...customShapeUtils,
]

/**
 * tldraw's default "black" ink is soft grey (#1d1d1d / #f2f2f2). That reads as grey on our
 * canvas, especially for thin strokes — bump black/white to full contrast.
 */
const lightColors = DEFAULT_THEME.colors.light
const darkColors = DEFAULT_THEME.colors.dark

/** tldraw's "sans" font becomes Inter, so arrow labels / sans text match diagram cards. */
export const diagramThemes: Partial<TLThemes> = {
  default: {
    ...DEFAULT_THEME,
    fonts: {
      ...DEFAULT_THEME.fonts,
      sans: { ...DEFAULT_THEME.fonts.sans, fontFamily: FONT_STACK, faces: [] },
    },
    colors: {
      light: {
        ...lightColors,
        black: {
          ...lightColors.black,
          solid: '#000000',
          fill: '#000000',
          linedFill: '#111111',
          pattern: '#000000',
        },
        white: {
          ...lightColors.white,
          solid: '#FFFFFF',
          fill: '#FFFFFF',
        },
      },
      dark: {
        ...darkColors,
        // First swatch in the picker: should paint bright white on the dark canvas.
        black: {
          ...darkColors.black,
          solid: '#FFFFFF',
          fill: '#FFFFFF',
          linedFill: '#FFFFFF',
          pattern: '#FFFFFF',
          noteText: '#FFFFFF',
          frameText: '#FFFFFF',
        },
        white: {
          ...darkColors.white,
          solid: '#FFFFFF',
          fill: '#FFFFFF',
          linedFill: '#FFFFFF',
          pattern: '#FFFFFF',
        },
      },
    },
  },
}
