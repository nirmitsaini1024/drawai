import { describe, expect, test } from 'vitest'
import ELK from 'elkjs/lib/elk.bundled.js'
import { runElk, SPACING, type LayoutInput, type Rect } from '../layout'
import { normalizeGraph } from '../normalize'
import { measureNode, LABEL_LINE_H, type FontSpec } from '../sizing'
import { polylineHitsRect } from '../routing'
import { TONE_COLORS, contrastRatio } from '../../../lib/diagramTheme'
import type { Graph } from '../../types'

type Tone = keyof typeof TONE_COLORS
const width = (t: string, f: FontSpec) => t.length * f.size * 0.55

const graphs: Record<string, Graph> = {
  login: {
    direction: 'auto',
    nodes: [
      { id: 'start', label: 'Start', kind: 'start' },
      { id: 'cred', label: 'Enter credentials', kind: 'process' },
      { id: 'valid', label: 'Credentials valid?', kind: 'decision' },
      { id: 'mfa', label: 'Send MFA code', kind: 'process' },
      { id: 'mfaok', label: 'MFA code correct?', kind: 'decision' },
      { id: 'home', label: 'Open dashboard', kind: 'end' },
      { id: 'err', label: 'Show error', kind: 'error' },
    ],
    edges: [
      { from: 'start', to: 'cred' },
      { from: 'cred', to: 'valid' },
      { from: 'valid', to: 'mfa', label: 'Yes' },
      { from: 'valid', to: 'err', label: 'No' },
      { from: 'mfa', to: 'mfaok' },
      { from: 'mfaok', to: 'home', label: 'Yes' },
      { from: 'mfaok', to: 'err', label: 'No' },
      { from: 'err', to: 'cred' },
    ],
  } as unknown as Graph,
  tiers: {
    direction: 'auto',
    groups: [
      { id: 'a', label: 'Web' },
      { id: 'b', label: 'Data' },
    ],
    nodes: [
      { id: 'user', label: 'User', kind: 'person' },
      { id: 'lb', label: 'Load balancer', group: 'a' },
      { id: 'w1', label: 'Web server', group: 'a' },
      { id: 'w2', label: 'Web server', group: 'a' },
      { id: 'db', label: 'Database', kind: 'database', group: 'b' },
    ],
    edges: [
      { from: 'user', to: 'lb' },
      { from: 'lb', to: 'w1' },
      { from: 'lb', to: 'w2' },
      { from: 'w1', to: 'db' },
      { from: 'w2', to: 'db' },
    ],
  } as unknown as Graph,
}

async function layout(g: Graph) {
  const n = normalizeGraph(g)
  const sizes = new Map(n.nodes.map((x) => [x.id, measureNode(x, width)]))
  const input: LayoutInput = {
    nodes: n.nodes.map((x) => ({ id: x.id, w: sizes.get(x.id)!.w, h: sizes.get(x.id)!.h, group: x.group })),
    edges: n.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, label: e.label ? { w: 36, h: 22 } : undefined })),
    groups: n.groups.map((x) => ({ id: x.id, minW: 100 })),
  }
  const res = await runElk(new ELK() as never, input, 'TB')
  return { n, input, res, sizes }
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const gap = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))

describe.each(Object.keys(graphs))('layout %s', (name) => {
  test('nodes never overlap and keep minimum spacing', async () => {
    const { n, res } = await layout(graphs[name])
    const ids = n.nodes.map((x) => x.id)
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = res.nodes[ids[i]]
        const b = res.nodes[ids[j]]
        expect(overlap(a, b), `${ids[i]} / ${ids[j]}`).toBe(false)
        expect(gap(a, b), ids[i] + '/' + ids[j]).toBeGreaterThanOrEqual(SPACING.node - 8)
      }
  })

  test('edge routes do not pass through non-endpoint nodes', async () => {
    const { n, res } = await layout(graphs[name])
    for (const e of n.edges) {
      const pts = res.edges[e.id]?.points
      if (!pts) continue
      for (const node of n.nodes) {
        if (node.id === e.from || node.id === e.to) continue
        expect(polylineHitsRect(pts, res.nodes[node.id], -2), `${e.id} through ${node.id}`).toBe(false)
      }
    }
  })

  test('groups contain their members', async () => {
    const { n, res } = await layout(graphs[name])
    for (const node of n.nodes) {
      if (!node.group) continue
      const g = res.groups[node.group]
      const r = res.nodes[node.id]
      expect(r.x >= g.x && r.y >= g.y && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h).toBe(true)
    }
  })
})

describe('sizing', () => {
  test('labels fit inside their node with padding and wrap at max width', () => {
    const long = 'Application load balancer for all public traffic'
    const s = measureNode({ label: long, shape: 'process' }, width)
    expect(s.lines.length).toBeGreaterThan(1)
    expect(s.textW).toBeLessThanOrEqual(s.w - 24 * 2 + 1)
    expect(s.lines.length * LABEL_LINE_H).toBeLessThanOrEqual(s.h - 16 * 2 + 1)
  })

  test('minimum sizes are respected', () => {
    const s = measureNode({ label: 'A', shape: 'process' }, width)
    expect(s.w).toBeGreaterThanOrEqual(120)
    expect(s.h).toBeGreaterThanOrEqual(44)
  })
})

describe('normalize', () => {
  test('drops unknown refs, self loops and duplicates; infers kinds and tones', () => {
    const n = normalizeGraph({
      direction: 'TB',
      nodes: [
        { id: 'a', label: 'Start', kind: 'start' },
        { id: 'b', label: 'Check?', kind: 'decision' },
        { id: 'c', label: 'Show error', kind: 'process' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'b' },
        { from: 'b', to: 'zzz' },
        { from: 'b', to: 'c', label: 'No' },
      ],
    } as unknown as Graph)
    expect(n.edges.map((e) => e.from + e.to)).toEqual(['ab', 'bc'])
    expect(n.edges[1].kind).toBe('no')
    expect(n.nodes[2].tone).toBe('danger')
    expect(n.nodes[1].shape).toBe('decision')
  })
})

describe('theme', () => {
  const tones = Object.keys(TONE_COLORS) as Tone[]
  test.each(tones.flatMap((t) => (['light', 'dark'] as const).map((m) => [t, m] as const)))(
    '%s/%s text contrast >= 4.5',
    (t, m) => {
      const c = TONE_COLORS[t][m]
      expect(contrastRatio(c.text, c.fill)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(c.muted, c.fill)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
