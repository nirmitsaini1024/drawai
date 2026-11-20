import { DefaultColorStyle, DefaultSizeStyle, type Editor, type VecLike } from 'tldraw'
import { ICON_SHAPE_TYPE } from '../shapes/iconTypes'
import { getPreset } from './presets'
import type { PresetKind } from './presetKinds'

export const PRESET_DRAG_MIME = 'application/x-drawai-preset'

export function insertPresetShape(
  editor: Editor,
  kind: PresetKind | string,
  point?: VecLike,
): void {
  const preset = getPreset(kind)
  const w = preset?.defaultSize.w ?? 100
  const h = preset?.defaultSize.h ?? 100
  const label = preset?.label ?? kind
  const color = editor.getStyleForNextShape(DefaultColorStyle)
  const size = editor.getStyleForNextShape(DefaultSizeStyle)

  const center =
    point ??
    (() => {
      const bounds = editor.getViewportPageBounds()
      return { x: bounds.midX, y: bounds.midY }
    })()

  editor.markHistoryStoppingPoint('insert-preset')
  editor.createShape({
    type: ICON_SHAPE_TYPE,
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: {
      kind,
      w,
      h,
      label,
      color,
      size,
    },
  })
}
