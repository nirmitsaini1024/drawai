import { test } from 'vitest'
import ELK from 'elkjs/lib/elk.bundled.js'
import { runElk, LAYOUT_OVERRIDES } from '../layout'
import { normalizeGraph } from '../normalize'
import { measureNode } from '../sizing'
import g3 from '/tmp/graphs/g3.json'
const width = (t: string, f: { size: number }) => t.length * f.size * 0.55
test('probe', async () => {
  const n = normalizeGraph(g3 as never)
  const sizes = new Map(n.nodes.map((x) => [x.id, measureNode(x, width)]))
  const input = {
    nodes: n.nodes.map((x) => ({ id: x.id, w: sizes.get(x.id)!.w, h: sizes.get(x.id)!.h, group: x.group })),
    edges: n.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, label: e.label ? { w: 30, h: 20 } : undefined })),
    groups: n.groups.map((g) => ({ id: g.id, minW: 100 })),
  }
  const variants: Record<string, Record<string, string>> = {
    base: {},
    nomo: { 'elk.layered.considerModelOrder.strategy': 'NONE' },
    greedy: { 'elk.layered.cycleBreaking.strategy': 'GREEDY' },
    ns: { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' },
    nolab: {},
  }
  for (const [name, o] of Object.entries(variants)) {
    for (const k of Object.keys(LAYOUT_OVERRIDES)) delete LAYOUT_OVERRIDES[k]
    Object.assign(LAYOUT_OVERRIDES, o)
    const inp = name === 'nolab' ? { ...input, edges: input.edges.map((e) => ({ ...e, label: undefined })) } : input
    const r = await runElk(new ELK() as never, inp, 'TB')
    console.log('V', name, n.nodes.map((x) => `${x.id}@${Math.round(r.nodes[x.id]!.x)},${Math.round(r.nodes[x.id]!.y)}`).join(' '), '|', Math.round(r.bounds.w), Math.round(r.bounds.h))
  }
})
