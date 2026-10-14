import { describe, expect, it, vi } from 'vitest'
import { createMorphAnalyzerClient, type WorkerLike } from './analyzer-client'
import type { AnalyzerRequest, AnalyzerResponse } from './protocol'

function fakeWorker() {
  const sent: AnalyzerRequest[] = []
  const w: WorkerLike & {
    sent: AnalyzerRequest[]
    emit: (m: AnalyzerResponse) => void
    crash: () => void
  } = {
    sent,
    onmessage: null,
    onerror: null,
    postMessage: (m) => sent.push(m),
    terminate: vi.fn(),
    emit: (m) => w.onmessage?.({ data: m } as MessageEvent<AnalyzerResponse>),
    crash: () => w.onerror?.(new Event('error')),
  }
  return w
}

const result = { currentTokens: [], workVariants: { groups: [], groupOf: {} }, frequent: [] }

describe('createMorphAnalyzerClient（COT-40）', () => {
  it('起動で init を送り、進み具合 → 準備完了の状態になる', () => {
    const w = fakeWorker()
    const c = createMorphAnalyzerClient(() => w)
    c.start('黒鉄城,カスタム名詞,クロガネジョウ\n', ['黒鉄城'])
    expect(w.sent[0]).toEqual({
      type: 'init',
      userDictCsv: '黒鉄城,カスタム名詞,クロガネジョウ\n',
      excluded: ['黒鉄城'],
    })
    expect(c.getState()).toEqual({ status: 'loading', loaded: 0, total: 0 })
    w.emit({ type: 'progress', loaded: 5, total: 10 })
    expect(c.getState()).toEqual({ status: 'loading', loaded: 5, total: 10 })
    w.emit({ type: 'ready' })
    expect(c.getState()).toEqual({ status: 'ready', work: null })
  })

  it('analyze は準備前なら reject、準備後は結果で resolve し、作品全体の進み具合を出す', async () => {
    const w = fakeWorker()
    const c = createMorphAnalyzerClient(() => w)
    await expect(c.analyze([], 'e1')).rejects.toThrow()
    c.start('', [])
    w.emit({ type: 'ready' })
    const p = c.analyze([{ id: 'e1', hash: 'h', texts: ['a'] }], 'e1')
    const req = w.sent.at(-1) as Extract<AnalyzerRequest, { type: 'analyze' }>
    expect(req).toMatchObject({ type: 'analyze', currentId: 'e1' })
    w.emit({ type: 'workProgress', id: req.id, done: 1, total: 3 })
    expect(c.getState()).toEqual({ status: 'ready', work: { done: 1, total: 3 } })
    w.emit({ type: 'analysis', id: req.id, ...result })
    await expect(p).resolves.toEqual(result)
    expect(c.getState()).toEqual({ status: 'ready', work: null })
  })

  it('失敗・Worker ごと落ちた・止めたときの状態', async () => {
    const w = fakeWorker()
    const c = createMorphAnalyzerClient(() => w)
    c.start('', [])
    w.emit({ type: 'error', reason: 'offline' })
    expect(c.getState()).toEqual({ status: 'error', reason: 'offline' })

    const w2 = fakeWorker()
    const c2 = createMorphAnalyzerClient(() => w2)
    c2.start('', [])
    w2.emit({ type: 'ready' })
    const pending = c2.analyze([], 'e1')
    w2.crash()
    await expect(pending).rejects.toThrow()
    expect(c2.getState()).toEqual({ status: 'error', reason: 'memory' })
    expect(w2.terminate).toHaveBeenCalled()

    const w3 = fakeWorker()
    const c3 = createMorphAnalyzerClient(() => w3)
    c3.start('', [])
    c3.stop()
    expect(w3.terminate).toHaveBeenCalled()
    expect(c3.getState()).toEqual({ status: 'idle' })
  })

  it('Worker を作れない環境では unsupported', () => {
    const c = createMorphAnalyzerClient(() => {
      throw new Error('no worker')
    })
    c.start('', [])
    expect(c.getState()).toEqual({ status: 'error', reason: 'unsupported' })
  })
})
