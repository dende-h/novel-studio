import init, * as lindera from 'lindera-wasm'
import {
  type AnalyzerEngine,
  classifyFailure,
  createAnalyzerEngine,
  type LinderaLike,
} from './analyzer-engine'
import { type AnalyzerRequest, type AnalyzerResponse, DICT_BYTES, DICT_URL } from './protocol'

/**
 * 推敲画面の解析 Worker（COT-40）。推敲画面を開いている間だけ生きる（窓口が terminate する）。
 * 辞書の zip は同じ配信元の /dict/ から取り、Cache Storage（ns-dict-v1）に置いて 2 回目以降は取りに行かない。
 * wasm は lindera-wasm が import.meta.url で引く（Vite がアセットとして出す・SW の runtimeCaching で保持）。
 */
interface WorkerScope {
  postMessage(message: AnalyzerResponse): void
  onmessage: ((e: MessageEvent<AnalyzerRequest>) => void) | null
}
const scope = self as unknown as WorkerScope
const post = (m: AnalyzerResponse) => scope.postMessage(m)

const CACHE = 'ns-dict-v1'

async function readStream(res: Response): Promise<Uint8Array> {
  const total = Number(res.headers.get('content-length')) || DICT_BYTES
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let loaded = 0
  let lastPost = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (loaded - lastPost > 256 * 1024) {
      lastPost = loaded
      post({ type: 'progress', loaded, total })
    }
  }
  post({ type: 'progress', loaded, total: Math.max(total, loaded) })
  const out = new Uint8Array(loaded)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}

async function loadDictZip(): Promise<Uint8Array> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(DICT_URL)
    if (hit) return new Uint8Array(await hit.arrayBuffer())
  } catch {
    cache = null // プライベートブラウズ等で Cache Storage が使えなくても、取得だけは続ける
  }
  post({ type: 'progress', loaded: 0, total: DICT_BYTES })
  const res = await fetch(DICT_URL)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const bytes = await readStream(res)
  if (cache) {
    try {
      // 版を上げたら古い辞書は消す（キーは URL。いまの版だけを残す）
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname !== DICT_URL) await cache.delete(req)
      }
      await cache.put(
        DICT_URL,
        new Response(bytes as BlobPart, { headers: { 'content-type': 'application/zip' } }),
      )
    } catch {
      // 保存できなくても今回の解析は続ける
    }
  }
  return bytes
}

let engine: AnalyzerEngine | null = null

scope.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      await init()
      const next = createAnalyzerEngine(lindera as unknown as LinderaLike, loadDictZip)
      await next.init(msg.userDictCsv, msg.excluded)
      engine = next
      post({ type: 'ready' })
    } catch (err) {
      post({ type: 'error', reason: navigator.onLine === false ? 'offline' : classifyFailure(err) })
    }
    return
  }
  if (msg.type === 'analyze') {
    if (!engine) {
      post({ type: 'analysisError', id: msg.id, reason: 'unknown' })
      return
    }
    try {
      const result = engine.analyze(msg.episodes, msg.currentId, (done, total) =>
        post({ type: 'workProgress', id: msg.id, done, total }),
      )
      post({ type: 'analysis', id: msg.id, ...result })
    } catch (err) {
      post({ type: 'analysisError', id: msg.id, reason: classifyFailure(err) })
    }
  }
}
