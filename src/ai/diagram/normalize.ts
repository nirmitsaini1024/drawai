/** Resolve a loosely-typed Graph (from the LLM, Mermaid, edit ops...) into fully specified nodes. */
import { getPreset } from '../../library/presets'
import {
  EDGE_KINDS,
  NODE_SHAPES,
  TONES,
  type EdgeKind,
  type Graph,
  type GraphDirection,
  type NodeShape,
  type Tone,
} from '../types'

export type NNode = {
  id: string
  label: string
  description?: string
  shape: NodeShape
  tone: Tone
  /** Preset kind to draw as an icon inside the card (undefined = no icon). */
  icon?: string
  group?: string
}

export type NEdge = {
  id: string
  from: string
  to: string
  label?: string
  kind: EdgeKind
}

export type NGroup = { id: string; label: string; tone: Tone }

export type NormalizedGraph = {
  direction: GraphDirection
  nodes: NNode[]
  edges: NEdge[]
  groups: NGroup[]
}

export const MAX_LABEL_CHARS = 60
export const MAX_DESCRIPTION_CHARS = 90

const shapeSet = new Set<string>(NODE_SHAPES)
const toneSet = new Set<string>(TONES)
const edgeKindSet = new Set<string>(EDGE_KINDS)

export function isIconKind(kind: string): boolean {
  const cat = getPreset(kind)?.category
  return cat === 'Infrastructure' || cat === 'AWS'
}

export function shapeFromKind(kind: string): NodeShape {
  switch (kind) {
    case 'start-end':
    case 'ellipse':
      return 'terminator'
    case 'decision':
    case 'diamond':
      return 'decision'
    case 'input-output':
      return 'io'
    case 'document':
    case 'note':
      return 'document'
    case 'database':
    case 'rds':
    case 'dynamodb':
      return 'data'
    case 'person':
      return 'person'
    default:
      return isIconKind(kind) ? 'service' : 'process'
  }
}

const ERROR_RE = /\b(error|fail(ed|ure|s)?|reject(ed)?|denied|invalid|timeout|blocked|locked|unauthori[sz]ed|retry exhausted|abort(ed)?|rollback)\b/i
const SUCCESS_RE = /\b(success(ful)?|approved|granted|complete(d)?|done|deployed|logged in|authenticated|verified|released|published)\b/i

function clean(text: string | undefined, max: number): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function normalizeGraph(graph: Graph): NormalizedGraph {
  const seen = new Set<string>()
  const rawNodes = graph.nodes.filter((n) => {
    if (!n || typeof n.id !== 'string' || seen.has(n.id)) return false
    seen.add(n.id)
    return true
  })

  const edgeKeys = new Set<string>()
  const edgesIn = (graph.edges ?? []).filter((e) => {
    if (!seen.has(e.from) || !seen.has(e.to) || e.from === e.to) return false
    const key = `${e.from}\u0000${e.to}\u0000${e.label ?? ''}`
    if (edgeKeys.has(key)) return false
    edgeKeys.add(key)
    return true
  })
  const hasIncoming = new Set(edgesIn.map((e) => e.to))

  const groupIds = new Set<string>()
  const groupsRaw = (graph.groups ?? []).filter((g) => {
    if (!g || typeof g.id !== 'string' || groupIds.has(g.id)) return false
    groupIds.add(g.id)
    return true
  })

  const nodes: NNode[] = rawNodes.map((n) => {
    const kind = typeof n.kind === 'string' ? n.kind : 'process'
    const label = clean(n.label, MAX_LABEL_CHARS) || n.id
    const shape: NodeShape = shapeSet.has(String(n.shape))
      ? (n.shape as NodeShape)
      : shapeFromKind(kind)
    const isStart = shape === 'terminator' && !hasIncoming.has(n.id)

    let tone: Tone
    if (toneSet.has(String(n.tone))) tone = n.tone as Tone
    else if (ERROR_RE.test(label)) tone = 'danger'
    else if (isStart) tone = 'success'
    else if (shape === 'terminator') tone = SUCCESS_RE.test(label) ? 'success' : 'neutral'
    else if (shape === 'decision') tone = 'warning'
    else if (shape === 'data' || shape === 'io') tone = 'info'
    else if (shape === 'person' || shape === 'document') tone = 'neutral'
    else tone = 'primary'

    const showsIcon = shape === 'service' || shape === 'person' || shape === 'process' || shape === 'io'
    const icon = showsIcon && isIconKind(kind) ? kind : undefined
    const description = clean(n.description, MAX_DESCRIPTION_CHARS) || undefined
    const group = n.group && groupIds.has(n.group) ? n.group : undefined
    return { id: n.id, label, description, shape, tone, icon, group }
  })

  const usedGroups = new Set(nodes.map((n) => n.group).filter(Boolean) as string[])
  const groups: NGroup[] = groupsRaw
    .filter((g) => usedGroups.has(g.id))
    .map((g) => ({
      id: g.id,
      label: clean(g.label, MAX_LABEL_CHARS) || g.id,
      tone: toneSet.has(String(g.tone)) ? (g.tone as Tone) : 'neutral',
    }))

  const edges: NEdge[] = edgesIn.map((e, i) => {
    const label = clean(e.label, 40) || undefined
    let kind: EdgeKind = edgeKindSet.has(String(e.kind)) ? (e.kind as EdgeKind) : 'default'
    if (kind === 'default' && label) {
      const low = label.toLowerCase()
      if (low === 'yes' || low === 'true' || low === 'ok') kind = 'yes'
      else if (low === 'no' || low === 'false') kind = 'no'
      else if (ERROR_RE.test(low)) kind = 'error'
    }
    return { id: `e${i}`, from: e.from, to: e.to, label, kind }
  })

  const direction: GraphDirection =
    graph.direction === 'LR' || graph.direction === 'TB' ? graph.direction : 'auto'

  return { direction, nodes, edges, groups }
}
