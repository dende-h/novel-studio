import type {
  AnalysisResult,
  AnalyzeEpisode,
  AnalyzerFailure,
  AnalyzerRequest,
  AnalyzerResponse,
} from './protocol'

/**
 * 推敲画面の解析 Worker の窓口（COT-40）。Worker の起動・停止と、くわしい確認の状態を持つ自前ストア。
 * 状態管理ライブラリは使わない（useSyncExternalStore で読む）。
 */
export type AnalyzerState =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number }
  | { status: 'ready'; work: { done: number; total: number } | null }
  | { status: 'error'; reason: AnalyzerFailure }

export interface WorkerLike {
  postMessage(message: AnalyzerRequest): void
  terminate(): void
  onmessage: ((e: MessageEvent<AnalyzerResponse>) => void) | null
  onerror: ((e: ErrorEvent | Event) => void) | null
}

export interface MorphAnalyzerClient {
  getState(): AnalyzerState
  subscribe(listener: () => void): () => void
  /** Worker を（作り直して）起動し、辞書の準備を始める。 */
  start(userDictCsv: string, excluded: ReadonlyArray<string>): void
  /** 準備ができていれば作品を解析する。準備前・失敗時・停止時は reject。 */
  analyze(episodes: ReadonlyArray<AnalyzeEpisode>, currentId: string): Promise<AnalysisResult>
  /** Worker を止めてメモリを返す。 */
  stop(): void
}

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike

export function createMorphAnalyzerClient(
  createWorker: () => WorkerLike = defaultWorker,
): MorphAnalyzerClient {
  let state: AnalyzerState = { status: 'idle' }
  let worker: WorkerLike | null = null
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void }
  >()
  const listeners = new Set<() => void>()

  const set = (next: AnalyzerState) => {
    state = next
    for (const l of listeners) l()
  }
  const rejectAll = (reason: string) => {
    for (const p of pending.values()) p.reject(new Error(reason))
    pending.clear()
  }
  const stop = () => {
    worker?.terminate()
    worker = null
    rejectAll('stopped')
    if (state.status !== 'idle') set({ status: 'idle' })
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start(userDictCsv, excluded) {
      stop()
      let w: WorkerLike
      try {
        w = createWorker()
      } catch {
        set({ status: 'error', reason: 'unsupported' })
        return
      }
      worker = w
      set({ status: 'loading', loaded: 0, total: 0 })
      w.onmessage = (e) => {
        if (worker !== w) return
        const m = e.data
        switch (m.type) {
          case 'progress':
            set({ status: 'loading', loaded: m.loaded, total: m.total })
            break
          case 'ready':
            set({ status: 'ready', work: null })
            break
          case 'error':
            set({ status: 'error', reason: m.reason })
            break
          case 'workProgress':
            if (state.status === 'ready') {
              set({
                status: 'ready',
                work: m.done < m.total ? { done: m.done, total: m.total } : null,
              })
            }
            break
          case 'analysis': {
            const { type: _t, id, ...result } = m
            pending.get(id)?.resolve(result)
            pending.delete(id)
            if (state.status === 'ready' && state.work) set({ status: 'ready', work: null })
            break
          }
          case 'analysisError':
            pending.get(m.id)?.reject(new Error(m.reason))
            pending.delete(m.id)
            break
        }
      }
      // Worker ごと落ちた（メモリ不足など）。くわしい確認だけを止め、ほかの項目は動き続ける
      w.onerror = () => {
        if (worker !== w) return
        w.terminate()
        worker = null
        rejectAll('crashed')
        set({ status: 'error', reason: 'memory' })
      }
      w.postMessage({ type: 'init', userDictCsv, excluded: [...excluded] })
    },
    analyze(episodes, currentId) {
      if (!worker || state.status !== 'ready') return Promise.reject(new Error('not ready'))
      const id = nextId++
      const w = worker
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({ type: 'analyze', id, episodes: [...episodes], currentId })
      })
    },
    stop,
  }
}
