import type { PresetCategory, PresetKind } from './presetKinds'
import { PRESET_KINDS } from './presetKinds'

export type PresetDefinition = {
  kind: PresetKind
  label: string
  category: PresetCategory
  defaultSize: { w: number; h: number }
}

/**
 * Registry of built-in presets. To add a new preset:
 * 1. Add the kind to PRESET_KINDS
 * 2. Draw an SVG in presetIcons.tsx
 * 3. Add an entry here
 */
export const PRESETS: PresetDefinition[] = [
  // Basic
  { kind: 'rect', label: 'Rectangle', category: 'Basic', defaultSize: { w: 120, h: 80 } },
  { kind: 'rounded-rect', label: 'Rounded rect', category: 'Basic', defaultSize: { w: 120, h: 80 } },
  { kind: 'ellipse', label: 'Ellipse', category: 'Basic', defaultSize: { w: 120, h: 80 } },
  { kind: 'diamond', label: 'Diamond', category: 'Basic', defaultSize: { w: 100, h: 100 } },
  { kind: 'cloud', label: 'Cloud', category: 'Basic', defaultSize: { w: 140, h: 90 } },
  { kind: 'hexagon', label: 'Hexagon', category: 'Basic', defaultSize: { w: 110, h: 100 } },
  { kind: 'note', label: 'Note', category: 'Basic', defaultSize: { w: 100, h: 120 } },
  // Infrastructure
  { kind: 'database', label: 'Database', category: 'Infrastructure', defaultSize: { w: 90, h: 110 } },
  { kind: 'server', label: 'Server', category: 'Infrastructure', defaultSize: { w: 100, h: 110 } },
  { kind: 'queue', label: 'Queue', category: 'Infrastructure', defaultSize: { w: 120, h: 80 } },
  { kind: 'cache', label: 'Cache', category: 'Infrastructure', defaultSize: { w: 100, h: 90 } },
  { kind: 'api-gateway', label: 'API gateway', category: 'Infrastructure', defaultSize: { w: 120, h: 90 } },
  { kind: 'load-balancer', label: 'Load balancer', category: 'Infrastructure', defaultSize: { w: 120, h: 110 } },
  { kind: 'person', label: 'Person', category: 'Infrastructure', defaultSize: { w: 80, h: 110 } },
  { kind: 'browser', label: 'Browser', category: 'Infrastructure', defaultSize: { w: 120, h: 90 } },
  { kind: 'mobile', label: 'Mobile', category: 'Infrastructure', defaultSize: { w: 70, h: 120 } },
  { kind: 'firewall', label: 'Firewall', category: 'Infrastructure', defaultSize: { w: 110, h: 90 } },
  // AWS
  { kind: 'ec2', label: 'Compute', category: 'AWS', defaultSize: { w: 96, h: 96 } },
  { kind: 's3', label: 'Object storage', category: 'AWS', defaultSize: { w: 96, h: 96 } },
  { kind: 'lambda', label: 'Function', category: 'AWS', defaultSize: { w: 96, h: 96 } },
  { kind: 'rds', label: 'Relational DB', category: 'AWS', defaultSize: { w: 96, h: 110 } },
  { kind: 'dynamodb', label: 'Key-value DB', category: 'AWS', defaultSize: { w: 96, h: 96 } },
  { kind: 'sqs', label: 'Message queue', category: 'AWS', defaultSize: { w: 110, h: 90 } },
  { kind: 'sns', label: 'Pub/sub', category: 'AWS', defaultSize: { w: 110, h: 100 } },
  { kind: 'cloudfront', label: 'CDN', category: 'AWS', defaultSize: { w: 96, h: 96 } },
  { kind: 'aws-api-gateway', label: 'API gateway', category: 'AWS', defaultSize: { w: 110, h: 90 } },
  { kind: 'vpc', label: 'Network', category: 'AWS', defaultSize: { w: 120, h: 90 } },
  // Flowchart
  { kind: 'start-end', label: 'Start / End', category: 'Flowchart', defaultSize: { w: 140, h: 60 } },
  { kind: 'process', label: 'Process', category: 'Flowchart', defaultSize: { w: 140, h: 80 } },
  { kind: 'decision', label: 'Decision', category: 'Flowchart', defaultSize: { w: 110, h: 110 } },
  { kind: 'input-output', label: 'Input / Output', category: 'Flowchart', defaultSize: { w: 140, h: 70 } },
  { kind: 'document', label: 'Document', category: 'Flowchart', defaultSize: { w: 110, h: 120 } },
]

const byKind = new Map(PRESETS.map((p) => [p.kind, p]))

export function getPreset(kind: string): PresetDefinition | undefined {
  return byKind.get(kind as PresetKind)
}

export function presetsByCategory(category: PresetCategory): PresetDefinition[] {
  return PRESETS.filter((p) => p.category === category)
}

/** JSON payload for backend sync (Phase 5). */
export function exportPresetKindsJson(): {
  kinds: readonly string[]
  presets: Array<{ kind: string; label: string; category: string }>
} {
  return {
    kinds: PRESET_KINDS,
    presets: PRESETS.map(({ kind, label, category }) => ({ kind, label, category })),
  }
}
