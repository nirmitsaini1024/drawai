/** Canonical preset kind list — shared source for registry, ShapeUtil, and (later) the AI backend. */
export const PRESET_KINDS = [
  // Basic
  'rect',
  'rounded-rect',
  'ellipse',
  'diamond',
  'cloud',
  'hexagon',
  'note',
  // Infrastructure
  'database',
  'server',
  'queue',
  'cache',
  'api-gateway',
  'load-balancer',
  'person',
  'browser',
  'mobile',
  'firewall',
  // AWS (original icons, not brand logos)
  'ec2',
  's3',
  'lambda',
  'rds',
  'dynamodb',
  'sqs',
  'sns',
  'cloudfront',
  'aws-api-gateway',
  'vpc',
  // Flowchart
  'start-end',
  'process',
  'decision',
  'input-output',
  'document',
] as const

export type PresetKind = (typeof PRESET_KINDS)[number]

export const PRESET_CATEGORIES = ['Basic', 'Infrastructure', 'AWS', 'Flowchart'] as const
export type PresetCategory = (typeof PRESET_CATEGORIES)[number]

export function isPresetKind(value: string): value is PresetKind {
  return (PRESET_KINDS as readonly string[]).includes(value)
}
