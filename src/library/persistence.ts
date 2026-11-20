/**
 * Shape-library persistence: IndexedDB first, background sync to the API.
 * `saveLibraryShapes` still takes the full list; we diff against what's stored to
 * decide which shapes to push and which deletions to queue.
 */
import { loadLocalLibrary, saveLocalLibrary } from '../lib/localDb'
import { markLibraryDeleted, markLibraryDirty } from '../lib/sync'
import type { LibraryShape } from './types'

export async function loadLibraryShapes(): Promise<LibraryShape[]> {
  return loadLocalLibrary()
}

function changed(prev: LibraryShape, next: LibraryShape): boolean {
  return (
    prev.name !== next.name ||
    prev.category !== next.category ||
    prev.thumbnail !== next.thumbnail ||
    (prev.content !== next.content && JSON.stringify(prev.content) !== JSON.stringify(next.content))
  )
}

export async function saveLibraryShapes(shapes: LibraryShape[]): Promise<void> {
  const prev = await loadLocalLibrary()
  const prevById = new Map(prev.map((s) => [s.id, s]))
  const nextIds = new Set(shapes.map((s) => s.id))

  const dirty = shapes
    .filter((s) => {
      const p = prevById.get(s.id)
      return !p || changed(p, s)
    })
    .map((s) => s.id)
  const removed = prev.filter((s) => !nextIds.has(s.id)).map((s) => s.id)

  await saveLocalLibrary(shapes)
  await markLibraryDeleted(removed)
  await markLibraryDirty(dirty)
}
