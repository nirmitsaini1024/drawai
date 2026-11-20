import type { TLShape } from 'tldraw'
import type { DiagramStyle } from '../lib/diagramTheme'

export const NODE_SHAPE_TYPE = 'dnode' as const
export const GROUP_SHAPE_TYPE = 'dgroup' as const

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [NODE_SHAPE_TYPE]: {
      /** Render shape: terminator | process | decision | hexagon | io | data | person | service | document */
      shape: string
      tone: string
      label: string
      description: string
      /** Preset kind drawn as an icon inside the card ('' = none). */
      icon: string
      w: number
      h: number
      look: DiagramStyle
    }
    [GROUP_SHAPE_TYPE]: {
      label: string
      tone: string
      w: number
      h: number
      look: DiagramStyle
    }
  }
}

export type DiagramNodeShape = TLShape<typeof NODE_SHAPE_TYPE>
export type DiagramGroupShape = TLShape<typeof GROUP_SHAPE_TYPE>

/** Meta stored on every diagram shape / arrow created by the AI pipeline. */
export type DiagramMeta = {
  /** Logical node id (from the Graph). */
  nodeId?: string
  /** Edge kind for arrows. */
  edgeKind?: string
}
