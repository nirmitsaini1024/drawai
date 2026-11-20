import { memo, useId } from 'react'
import type { TLGridProps } from 'tldraw'
import { getGridLevels } from '../lib/grid'
import { useAppStore } from '../store/appStore'

function patternOrigin(cameraAxis: number, zoom: number, cellScreen: number): number {
  const o = 0.5 + cameraAxis * zoom
  return o > 0 ? o % cellScreen : cellScreen + (o % cellScreen)
}

/**
 * Miro/FigJam-style square grid. Mounted via tldraw `components.Grid`.
 * Purely visual: pointer-events none (via .tl-grid), not exported as a shape.
 */
export const CanvasGrid = memo(function CanvasGrid({ x, y, z }: TLGridProps) {
  const showGrid = useAppStore((s) => s.showGrid)
  const gridStyle = useAppStore((s) => s.gridStyle)
  const reactId = useId()
  const uid = reactId.replace(/:/g, '')

  if (!showGrid || gridStyle === 'none') return null

  const { minorSize, majorSize, minorOpacity, majorOpacity } = getGridLevels(z)

  if (minorOpacity <= 0.001 && majorOpacity <= 0.001) return null

  const minorScreen = minorSize * z
  const majorScreen = majorSize * z
  const ox = patternOrigin(x, z, minorScreen)
  const oy = patternOrigin(y, z, minorScreen)
  const oxMajor = patternOrigin(x, z, majorScreen)
  const oyMajor = patternOrigin(y, z, majorScreen)

  const minorId = `drawai-grid-minor-${uid}`
  const majorId = `drawai-grid-major-${uid}`

  return (
    <svg
      className="tl-grid drawai-grid"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    >
      <defs>
        {gridStyle === 'lines' ? (
          <>
            <pattern
              id={minorId}
              width={minorScreen}
              height={minorScreen}
              patternUnits="userSpaceOnUse"
              x={ox}
              y={oy}
            >
              <path
                d={`M ${minorScreen} 0 L 0 0 0 ${minorScreen}`}
                fill="none"
                stroke="var(--drawai-grid-minor)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </pattern>
            <pattern
              id={majorId}
              width={majorScreen}
              height={majorScreen}
              patternUnits="userSpaceOnUse"
              x={oxMajor}
              y={oyMajor}
            >
              <path
                d={`M ${majorScreen} 0 L 0 0 0 ${majorScreen}`}
                fill="none"
                stroke="var(--drawai-grid-major)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </pattern>
          </>
        ) : (
          <>
            <pattern
              id={minorId}
              width={minorScreen}
              height={minorScreen}
              patternUnits="userSpaceOnUse"
              x={ox}
              y={oy}
            >
              <circle cx={0} cy={0} r={1} fill="var(--drawai-grid-minor)" />
            </pattern>
            <pattern
              id={majorId}
              width={majorScreen}
              height={majorScreen}
              patternUnits="userSpaceOnUse"
              x={oxMajor}
              y={oyMajor}
            >
              <circle cx={0} cy={0} r={1.25} fill="var(--drawai-grid-major)" />
            </pattern>
          </>
        )}
      </defs>
      {minorOpacity > 0.001 && (
        <rect width="100%" height="100%" fill={`url(#${minorId})`} opacity={minorOpacity} />
      )}
      {majorOpacity > 0.001 && (
        <rect width="100%" height="100%" fill={`url(#${majorId})`} opacity={majorOpacity} />
      )}
    </svg>
  )
})
