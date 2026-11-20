import {
  BaseBoxShapeUtil,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  DefaultColorStyle,
  DefaultSizeStyle,
  getColorValue,
  HTMLContainer,
  T,
  type RecordProps,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from 'tldraw'
import { isPresetKind, PRESET_KINDS } from '../library/presetKinds'
import { PresetIcon } from '../library/presetIcons'
import { getPreset } from '../library/presets'
import { ICON_SHAPE_TYPE, ICON_STROKE_SIZES, type IconShape } from './iconTypes'

const iconVersions = createShapePropsMigrationIds(ICON_SHAPE_TYPE, {
  AddSize: 1,
})

const iconMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: iconVersions.AddSize,
      up(props) {
        props.size = props.size ?? 'm'
      },
      down(props) {
        delete props.size
      },
    },
  ],
})

export class IconShapeUtil extends BaseBoxShapeUtil<IconShape> {
  static override type = ICON_SHAPE_TYPE
  static override migrations = iconMigrations

  static override props: RecordProps<IconShape> = {
    kind: T.literalEnum(...PRESET_KINDS),
    w: T.number,
    h: T.number,
    label: T.string,
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
  }

  getDefaultProps(): IconShape['props'] {
    return {
      kind: 'rect',
      w: 120,
      h: 80,
      label: 'Rectangle',
      color: 'black',
      size: 'm',
    }
  }

  override canEdit() {
    return true
  }

  override canResize() {
    return true
  }

  override isAspectRatioLocked() {
    return false
  }

  getShapeName(shape: IconShape) {
    return getPreset(shape.props.kind)?.label ?? (shape.props.label || 'Icon')
  }

  component(shape: IconShape) {
    const isEditing = this.editor.getEditingShapeId() === shape.id
    const theme = this.editor.getCurrentTheme()
    const colors = theme.colors[this.editor.getColorMode()]
    const stroke = getColorValue(colors, shape.props.color, 'solid')
    const kind = isPresetKind(shape.props.kind) ? shape.props.kind : 'rect'
    const size = (shape.props.size ?? 'm') as TLDefaultSizeStyle
    const strokeWidth = ICON_STROKE_SIZES[size] ?? ICON_STROKE_SIZES.m

    return (
      <HTMLContainer
        id={shape.id}
        onPointerDown={isEditing ? this.editor.markEventAsHandled : undefined}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: 6,
          pointerEvents: isEditing ? 'all' : 'none',
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, minHeight: 0, width: '100%', maxHeight: '70%' }}>
          <PresetIcon kind={kind} color={stroke} strokeWidth={strokeWidth} />
        </div>
        {isEditing ? (
          <input
            autoFocus
            defaultValue={shape.props.label}
            style={{
              width: '100%',
              border: '1px solid var(--tl-color-primary)',
              borderRadius: 4,
              padding: '2px 4px',
              fontSize: 12,
              textAlign: 'center',
              background: 'var(--tl-color-panel)',
              color: 'var(--tl-color-text)',
            }}
            onBlur={(e) => {
              this.editor.updateShape({
                id: shape.id,
                type: ICON_SHAPE_TYPE,
                props: { label: e.currentTarget.value },
              })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
                this.editor.setEditingShape(null)
              }
              if (e.key === 'Escape') {
                this.editor.setEditingShape(null)
              }
            }}
          />
        ) : (
          shape.props.label && (
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.2,
                textAlign: 'center',
                color: stroke,
                wordBreak: 'break-word',
                maxWidth: '100%',
              }}
            >
              {shape.props.label}
            </div>
          )
        )}
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: IconShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override toSvg(shape: IconShape) {
    const theme = this.editor.getCurrentTheme()
    const colors = theme.colors[this.editor.getColorMode()]
    const stroke = getColorValue(colors, shape.props.color as TLDefaultColorStyle, 'solid')
    const kind = isPresetKind(shape.props.kind) ? shape.props.kind : 'rect'
    const label = shape.props.label
    const size = (shape.props.size ?? 'm') as TLDefaultSizeStyle
    const strokeWidth = ICON_STROKE_SIZES[size] ?? ICON_STROKE_SIZES.m

    return (
      <g>
        <rect
          width={shape.props.w}
          height={shape.props.h}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          rx={kind === 'rounded-rect' || kind === 'start-end' ? 12 : 0}
        />
        {label ? (
          <text
            x={shape.props.w / 2}
            y={shape.props.h - 8}
            textAnchor="middle"
            fontSize={12}
            fill={stroke}
          >
            {label}
          </text>
        ) : null}
      </g>
    )
  }
}

