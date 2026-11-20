import {
  BaseBoxShapeUtil,
  Group2d,
  HTMLContainer,
  Polygon2d,
  Rectangle2d,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from 'tldraw'
import { PresetIcon } from '../library/presetIcons'
import { measureNodeInEditor } from '../ai/diagram/editorMeasure'
import type { NodeSize, RenderShape } from '../ai/diagram/sizing'
import { DESC_LINE_H, LABEL_LINE_H } from '../ai/diagram/sizing'
import type { Tone } from '../ai/types'
import {
  GROUP_METRICS,
  NODE_METRICS,
  TYPOGRAPHY,
  fontFamilyFor,
  hexToRgba,
  nodeShadow,
  toneColors,
  type DiagramStyle,
} from '../lib/diagramTheme'
import { GROUP_SHAPE_TYPE, NODE_SHAPE_TYPE, type DiagramGroupShape, type DiagramNodeShape } from './diagramTypes'
import { contentBox, nodePaths, polygonPoints } from './nodeGeometry'

const LOOKS = ['clean', 'sketch'] as const

const sizeCache = new Map<string, NodeSize>()

/** Memoised text layout for a node (so renders do not re-measure). */
function layoutFor(util: { editor: import('tldraw').Editor }, p: DiagramNodeShape['props']): NodeSize {
  const key = `${p.look}|${p.shape}|${p.icon}|${p.label}|${p.description}`
  let hit = sizeCache.get(key)
  if (!hit) {
    hit = measureNodeInEditor(
      util.editor,
      { label: p.label, description: p.description || undefined, icon: p.icon || undefined, shape: p.shape as RenderShape },
      p.look,
    )
    if (sizeCache.size > 500) sizeCache.clear()
    sizeCache.set(key, hit)
  }
  return hit
}

function strokeFor(look: DiagramStyle) {
  return look === 'sketch' ? 2 : NODE_METRICS.strokeWidth
}

function SketchFilter({ id }: { id: string }) {
  return (
    <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" />
    </filter>
  )
}

export class DiagramNodeShapeUtil extends BaseBoxShapeUtil<DiagramNodeShape> {
  static override type = NODE_SHAPE_TYPE

  static override props: RecordProps<DiagramNodeShape> = {
    shape: T.string,
    tone: T.string,
    label: T.string,
    description: T.string,
    icon: T.string,
    w: T.number,
    h: T.number,
    look: T.literalEnum(...LOOKS),
  }

  getDefaultProps(): DiagramNodeShape['props'] {
    return {
      shape: 'process',
      tone: 'primary',
      label: 'Step',
      description: '',
      icon: '',
      w: 140,
      h: 52,
      look: 'clean',
    }
  }

  override canEdit() {
    return true
  }
  override isAspectRatioLocked() {
    return false
  }
  override getShapeName(shape: DiagramNodeShape) {
    return shape.props.label || 'Node'
  }

  override onResize(shape: DiagramNodeShape, info: TLResizeInfo<DiagramNodeShape>) {
    return resizeBox(shape, info, { minWidth: 48, minHeight: 32 })
  }

  override getGeometry(shape: DiagramNodeShape) {
    const { w, h } = shape.props
    const pts = polygonPoints(shape.props.shape, w, h)
    if (pts) return new Polygon2d({ points: pts.map(([x, y]) => ({ x, y }) as never), isFilled: true })
    return new Rectangle2d({ width: w, height: h, isFilled: true })
  }

  component(shape: DiagramNodeShape) {
    const p = shape.props
    const editor = this.editor
    const isEditing = editor.getEditingShapeId() === shape.id
    const mode = editor.getColorMode()
    const colors = toneColors(p.tone as Tone, mode)
    const { d, extra } = nodePaths(p.shape, p.w, p.h)
    const box = contentBox(p.shape, p.w, p.h)
    const text = layoutFor(this, p)
    const sketch = p.look === 'sketch'
    const stroke = strokeFor(p.look)
    const filterId = `sk-${shape.id.replace(/[^a-zA-Z0-9]/g, '')}`
    const family = fontFamilyFor(p.look)

    return (
      <HTMLContainer
        id={shape.id}
        onPointerDown={isEditing ? editor.markEventAsHandled : undefined}
        style={{ width: p.w, height: p.h, pointerEvents: isEditing ? 'all' : 'none' }}
      >
        <svg
          width={p.w}
          height={p.h}
          viewBox={`0 0 ${p.w} ${p.h}`}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'visible',
            filter: sketch ? undefined : nodeShadow(mode),
          }}
        >
          {sketch && (
            <defs>
              <SketchFilter id={filterId} />
            </defs>
          )}
          <g filter={sketch ? `url(#${filterId})` : undefined}>
            <path
              d={d}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={stroke}
              strokeLinejoin="round"
            />
            {extra && (
              <path d={extra} fill="none" stroke={colors.stroke} strokeWidth={stroke} strokeLinejoin="round" />
            )}
          </g>
        </svg>
        <div
          style={{
            position: 'absolute',
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: NODE_METRICS.iconGap,
            fontFamily: family,
            color: colors.text,
            overflow: 'visible',
          }}
        >
          {p.icon && (
            <div style={{ width: NODE_METRICS.iconSize, height: NODE_METRICS.iconSize, flex: 'none' }}>
              <PresetIcon kind={p.icon} color={colors.stroke} strokeWidth={2.4} />
            </div>
          )}
          {isEditing ? (
            <input
              autoFocus
              defaultValue={p.label}
              style={{
                minWidth: 0,
                flex: 1,
                border: 'none',
                outline: `1.5px solid ${colors.stroke}`,
                borderRadius: 4,
                padding: '2px 4px',
                background: 'transparent',
                color: colors.text,
                fontFamily: family,
                fontSize: TYPOGRAPHY.label.size,
                fontWeight: TYPOGRAPHY.label.weight,
                textAlign: 'center',
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => this.commitLabel(shape, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') editor.setEditingShape(null)
                e.stopPropagation()
              }}
            />
          ) : (
            <div
              style={{
                textAlign: p.icon ? 'left' : 'center',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {text.lines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: TYPOGRAPHY.label.size,
                    fontWeight: sketch ? 600 : TYPOGRAPHY.label.weight,
                    lineHeight: `${LABEL_LINE_H}px`,
                    height: LABEL_LINE_H,
                  }}
                >
                  {line}
                </div>
              ))}
              {text.descLines.map((line, i) => (
                <div
                  key={`d${i}`}
                  style={{
                    fontSize: TYPOGRAPHY.description.size,
                    fontWeight: TYPOGRAPHY.description.weight,
                    lineHeight: `${DESC_LINE_H}px`,
                    height: DESC_LINE_H,
                    marginTop: i === 0 ? 2 : 0,
                    color: colors.muted,
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </HTMLContainer>
    )
  }

  /** Commit an edited label and re-fit the card around its centre. */
  private commitLabel(shape: DiagramNodeShape, value: string) {
    const label = value.trim() || shape.props.label
    const p = shape.props
    const size = measureNodeInEditor(
      this.editor,
      { label, description: p.description || undefined, icon: p.icon || undefined, shape: p.shape as RenderShape },
      p.look,
    )
    const cx = shape.x + p.w / 2
    const cy = shape.y + p.h / 2
    this.editor.setEditingShape(null)
    this.editor.updateShape<DiagramNodeShape>({
      id: shape.id,
      type: NODE_SHAPE_TYPE,
      x: cx - size.w / 2,
      y: cy - size.h / 2,
      props: { label, w: size.w, h: size.h, shape: size.shape },
    })
  }

  getIndicatorPath(shape: DiagramNodeShape) {
    return new Path2D(nodePaths(shape.props.shape, shape.props.w, shape.props.h).d)
  }

  override toSvg(shape: DiagramNodeShape) {
    const p = shape.props
    const mode = this.editor.getColorMode()
    const colors = toneColors(p.tone as Tone, mode)
    const { d, extra } = nodePaths(p.shape, p.w, p.h)
    const box = contentBox(p.shape, p.w, p.h)
    const text = layoutFor(this, p)
    const family = fontFamilyFor(p.look)
    const iconW = p.icon ? NODE_METRICS.iconSize + NODE_METRICS.iconGap : 0
    const blockH =
      text.lines.length * LABEL_LINE_H + (text.descLines.length ? 2 + text.descLines.length * DESC_LINE_H : 0)
    const top = box.y + (box.h - blockH) / 2
    const cx = box.x + box.w / 2 + iconW / 2
    return (
      <g>
        <path d={d} fill={colors.fill} stroke={colors.stroke} strokeWidth={strokeFor(p.look)} strokeLinejoin="round" />
        {extra && <path d={extra} fill="none" stroke={colors.stroke} strokeWidth={strokeFor(p.look)} />}
        {p.icon && (
          <svg
            x={cx - text.textW / 2 - iconW}
            y={box.y + (box.h - NODE_METRICS.iconSize) / 2}
            width={NODE_METRICS.iconSize}
            height={NODE_METRICS.iconSize}
          >
            <PresetIcon kind={p.icon} color={colors.stroke} strokeWidth={2.4} />
          </svg>
        )}
        {text.lines.map((line, i) => (
          <text
            key={i}
            x={cx}
            y={top + i * LABEL_LINE_H + LABEL_LINE_H * 0.72}
            textAnchor="middle"
            fontFamily={family}
            fontSize={TYPOGRAPHY.label.size}
            fontWeight={TYPOGRAPHY.label.weight}
            fill={colors.text}
          >
            {line}
          </text>
        ))}
        {text.descLines.map((line, i) => (
          <text
            key={`d${i}`}
            x={cx}
            y={top + text.lines.length * LABEL_LINE_H + 2 + i * DESC_LINE_H + DESC_LINE_H * 0.72}
            textAnchor="middle"
            fontFamily={family}
            fontSize={TYPOGRAPHY.description.size}
            fill={colors.muted}
          >
            {line}
          </text>
        ))}
      </g>
    )
  }
}

export class DiagramGroupShapeUtil extends BaseBoxShapeUtil<DiagramGroupShape> {
  static override type = GROUP_SHAPE_TYPE

  static override props: RecordProps<DiagramGroupShape> = {
    label: T.string,
    tone: T.string,
    w: T.number,
    h: T.number,
    look: T.literalEnum(...LOOKS),
  }

  getDefaultProps(): DiagramGroupShape['props'] {
    return { label: 'Group', tone: 'neutral', w: 320, h: 200, look: 'clean' }
  }

  override canEdit() {
    return true
  }
  override canReceiveNewChildrenOfType() {
    return true
  }
  override getShapeName(shape: DiagramGroupShape) {
    return shape.props.label || 'Group'
  }
  override onResize(shape: DiagramGroupShape, info: TLResizeInfo<DiagramGroupShape>) {
    return resizeBox(shape, info, { minWidth: 80, minHeight: 60 })
  }

  override getGeometry(shape: DiagramGroupShape) {
    const { w, h } = shape.props
    return new Group2d({
      children: [
        // Unfilled body: empty areas stay click-through so children and marquee still work.
        new Rectangle2d({ width: w, height: h, isFilled: false }),
        new Rectangle2d({ x: 0, y: 0, width: w, height: GROUP_METRICS.paddingTop - 4, isFilled: true }),
      ],
    })
  }

  component(shape: DiagramGroupShape) {
    const p = shape.props
    const editor = this.editor
    const isEditing = editor.getEditingShapeId() === shape.id
    const mode = editor.getColorMode()
    const colors = toneColors(p.tone as Tone, mode)
    const sketch = p.look === 'sketch'
    const family = fontFamilyFor(p.look)
    const filterId = `skg-${shape.id.replace(/[^a-zA-Z0-9]/g, '')}`
    return (
      <HTMLContainer
        id={shape.id}
        onPointerDown={isEditing ? editor.markEventAsHandled : undefined}
        style={{ width: p.w, height: p.h, pointerEvents: isEditing ? 'all' : 'none' }}
      >
        <svg
          width={p.w}
          height={p.h}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          {sketch && (
            <defs>
              <SketchFilter id={filterId} />
            </defs>
          )}
          <rect
            x={GROUP_METRICS.strokeWidth / 2}
            y={GROUP_METRICS.strokeWidth / 2}
            width={p.w - GROUP_METRICS.strokeWidth}
            height={p.h - GROUP_METRICS.strokeWidth}
            rx={GROUP_METRICS.radius}
            fill={hexToRgba(colors.stroke, mode === 'light' ? GROUP_METRICS.tintAlpha : 0.1)}
            stroke={colors.stroke}
            strokeOpacity={0.75}
            strokeWidth={GROUP_METRICS.strokeWidth}
            strokeDasharray="6 5"
            filter={sketch ? `url(#${filterId})` : undefined}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 10,
            right: 16,
            fontFamily: family,
            fontSize: TYPOGRAPHY.groupTitle.size,
            fontWeight: TYPOGRAPHY.groupTitle.weight,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: colors.muted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isEditing ? (
            <input
              autoFocus
              defaultValue={p.label}
              style={{
                width: '100%',
                border: 'none',
                outline: `1.5px solid ${colors.stroke}`,
                borderRadius: 4,
                background: 'transparent',
                color: colors.text,
                font: 'inherit',
                textTransform: 'inherit',
                letterSpacing: 'inherit',
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                editor.setEditingShape(null)
                editor.updateShape<DiagramGroupShape>({
                  id: shape.id,
                  type: GROUP_SHAPE_TYPE,
                  props: { label: e.currentTarget.value.trim() || p.label },
                })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') editor.setEditingShape(null)
                e.stopPropagation()
              }}
            />
          ) : (
            p.label
          )}
        </div>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: DiagramGroupShape) {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, GROUP_METRICS.radius)
    return path
  }

  override toSvg(shape: DiagramGroupShape) {
    const p = shape.props
    const mode = this.editor.getColorMode()
    const colors = toneColors(p.tone as Tone, mode)
    return (
      <g>
        <rect
          width={p.w}
          height={p.h}
          rx={GROUP_METRICS.radius}
          fill={hexToRgba(colors.stroke, mode === 'light' ? GROUP_METRICS.tintAlpha : 0.1)}
          stroke={colors.stroke}
          strokeOpacity={0.75}
          strokeWidth={GROUP_METRICS.strokeWidth}
          strokeDasharray="6 5"
        />
        <text
          x={16}
          y={24}
          fontFamily={fontFamilyFor(p.look)}
          fontSize={TYPOGRAPHY.groupTitle.size}
          fontWeight={TYPOGRAPHY.groupTitle.weight}
          fill={colors.muted}
          letterSpacing="0.04em"
        >
          {p.label.toUpperCase()}
        </text>
      </g>
    )
  }
}
