import { isPresetKind } from '../library/presetKinds'
import type { EditOp, SelectionShapePayload } from './types'
import { MAX_EDIT_OPS } from './types'

export type ValidateOpsResult =
  | { ok: true; ops: EditOp[] }
  | { ok: false; error: string }

/** Client-side gate: update/delete only unlocked selection IDs; create only registered kinds; ≤50 ops. */
export function validateEditOps(
  ops: EditOp[],
  selection: SelectionShapePayload[],
): ValidateOpsResult {
  if (!Array.isArray(ops)) return { ok: false, error: 'Invalid ops payload' }
  if (ops.length > MAX_EDIT_OPS) {
    return { ok: false, error: `Too many ops (max ${MAX_EDIT_OPS})` }
  }

  const byId = new Map(selection.map((s) => [s.id, s]))
  const allowed = new Set(selection.map((s) => s.id))
  const created = new Set<string>()
  const out: EditOp[] = []

  for (const op of ops) {
    if (!op || typeof op !== 'object' || !('op' in op)) {
      return { ok: false, error: 'Malformed op' }
    }

    switch (op.op) {
      case 'update': {
        const shape = byId.get(op.id)
        if (!shape) return { ok: false, error: `update targets non-selection id ${op.id}` }
        if (shape.locked) return { ok: false, error: `cannot update locked shape ${op.id}` }
        if (op.props?.kind != null && !isPresetKind(op.props.kind)) {
          return { ok: false, error: `unknown kind ${op.props.kind}` }
        }
        out.push(op)
        break
      }
      case 'delete': {
        const shape = byId.get(op.id)
        if (!shape) return { ok: false, error: `delete targets non-selection id ${op.id}` }
        if (shape.locked) return { ok: false, error: `cannot delete locked shape ${op.id}` }
        out.push(op)
        break
      }
      case 'create': {
        if (!isPresetKind(op.kind)) {
          return { ok: false, error: `create uses unregistered kind ${op.kind}` }
        }
        if (!op.tempId || created.has(op.tempId) || allowed.has(op.tempId)) {
          return { ok: false, error: `invalid create tempId ${op.tempId}` }
        }
        created.add(op.tempId)
        out.push(op)
        break
      }
      case 'connect': {
        const known = new Set([...allowed, ...created])
        if (!known.has(op.fromId) || !known.has(op.toId)) {
          return { ok: false, error: `connect references unknown ids` }
        }
        out.push(op)
        break
      }
      default:
        return { ok: false, error: 'Unknown op type' }
    }
  }

  return { ok: true, ops: out }
}
