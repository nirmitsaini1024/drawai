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

/** tldraw's "sans" font becomes Inter, so arrow labels / sans text match diagram cards. */
export const diagramThemes: Partial<TLThemes> = {
  default: {
    ...DEFAULT_THEME,
    fonts: {
      ...DEFAULT_THEME.fonts,
      sans: { ...DEFAULT_THEME.fonts.sans, fontFamily: FONT_STACK, faces: [] },
    },
  },
}
