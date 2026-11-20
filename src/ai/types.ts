import type { PresetKind } from '../library/presetKinds'

/** `auto` lets the layout engine pick; LR/TB are explicit user intent. */
export type GraphDirection = 'LR' | 'TB' | 'auto'

export const NODE_SHAPES = [
  'terminator',
  'process',
  'decision',
  'io',
  'data',
  'person',
  'service',
  'document',
] as const
export type NodeShape = (typeof NODE_SHAPES)[number]

export const TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const
export type Tone = (typeof TONES)[number]

export const EDGE_KINDS = ['default', 'yes', 'no', 'error', 'async'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export type GraphNode = {
  id: string
  label: string
  /** Preset kind; icon kinds (database, server, aws, ...) render an icon inside the card. */
  kind: PresetKind | string
  shape?: NodeShape | string
  tone?: Tone | string
  group?: string
  description?: string
}

export type GraphGroup = {
  id: string
  label: string
  tone?: Tone | string
}

export type GraphEdge = {
  from: string
  to: string
  label?: string
  kind?: EdgeKind | string
}

export type Graph = {
  direction: GraphDirection
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups?: GraphGroup[]
}

export type DiagramRequest = {
  prompt: string
  current?: Graph
}

/** Stored on AI-created shapes under `meta.drawai`. */
export type DrawAiMeta = {
  nodeId?: string
  graph?: Graph
}

export type SelectionBounds = {
  x: number
  y: number
  w: number
  h: number
}

export type SelectionShapePayload = {
  id: string
  type: string
  bounds: SelectionBounds
  props: Record<string, unknown>
  locked: boolean
}

export type SelectionBindingPayload = {
  arrowId: string
  fromId: string
  toId: string
  label?: string
}

export type EditRequest = {
  prompt: string
  shapes: SelectionShapePayload[]
  bindings: SelectionBindingPayload[]
  image_base64?: string
}

export type UpdateOp = {
  op: 'update'
  id: string
  x?: number
  y?: number
  props?: {
    label?: string
    kind?: string
    shape?: string
    tone?: string
    description?: string
    w?: number
    h?: number
    color?: string
  }
}

export type CreateOp = {
  op: 'create'
  tempId: string
  kind: string
  label: string
  shape?: string
  tone?: string
  description?: string
  x: number
  y: number
  w?: number
  h?: number
}

export type DeleteOp = {
  op: 'delete'
  id: string
}

export type ConnectOp = {
  op: 'connect'
  fromId: string
  toId: string
  label?: string
  kind?: string
}

export type EditOp = UpdateOp | CreateOp | DeleteOp | ConnectOp

export type EditResponse = {
  ops: EditOp[]
  summary?: string | null
}

export const MAX_EDIT_OPS = 50

export const EDIT_QUICK_ACTIONS = [
  'Clean up layout',
  'Clarify labels',
  'Align neatly',
  'Add a missing connection',
  'Simplify',
] as const

export type ImageDiagramRequest = {
  image_base64: string
  media_type: 'image/png' | 'image/jpeg' | 'image/webp'
  prompt?: string
}

export type MermaidRequest = {
  source: string
}

export type ExplainRequest = {
  mode: 'explain' | 'summarize'
  shapes: SelectionShapePayload[]
  bindings: SelectionBindingPayload[]
  image_base64?: string
}

export type TextResponse = {
  text: string
  refused?: boolean
  message?: string
}
