import ELK from 'elkjs/lib/elk-api.js'
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker'
import type { ELK as ElkInstance } from 'elkjs/lib/elk-api'

let instance: ElkInstance | null = null

/** Shared ELK instance whose layout runs in a web worker, so the UI never blocks. */
export function getElk(): ElkInstance {
  instance ??= new ELK({ workerFactory: () => new ElkWorker() })
  return instance
}
