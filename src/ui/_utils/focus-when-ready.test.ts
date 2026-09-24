import { describe, expect, it, vi } from 'vitest'
import { focusWhenReady } from './focus-when-ready'

/** 手で 1 フレームずつ進める偽の requestAnimationFrame。 */
function fakeFrames() {
  let next = 1
  const queue = new Map<number, FrameRequestCallback>()
  const raf = vi.fn((cb: FrameRequestCallback) => {
    const h = next++
    queue.set(h, cb)
    return h
  })
  const caf = vi.fn((h: number) => {
    queue.delete(h)
  })
  /** 予約済みのコールバックを 1 フレーム分だけ実行する。 */
  const tick = () => {
    const due = [...queue.entries()]
    queue.clear()
    for (const [, cb] of due) cb(0)
  }
  return { raf, caf, tick, pending: () => queue.size }
}

/**
 * 見えている間だけフォーカスを受け取る偽の入力欄（visibility:hidden の間は focus() が空振りする）。
 * 本物の DOM はレイアウトを持たず visibility で focus() の成否が変わらないため、偽物で振る舞いを固定する。
 */
interface FakeInput {
  visible: boolean
  ownerDocument: { activeElement: unknown }
  focus: ReturnType<typeof vi.fn>
}

function fakeInput(visible: boolean): FakeInput {
  const el: FakeInput = {
    visible,
    ownerDocument: { activeElement: null },
    focus: vi.fn(() => {
      if (el.visible) el.ownerDocument.activeElement = el
    }),
  }
  return el
}

const asEl = (el: FakeInput) => el as unknown as HTMLElement

describe('focusWhenReady', () => {
  it('最初から見えていれば、その場で 1 回フォーカスして次のフレームを予約しない', () => {
    const f = fakeFrames()
    const el = fakeInput(true)

    focusWhenReady(() => asEl(el), { raf: f.raf, caf: f.caf })

    expect(el.focus).toHaveBeenCalledTimes(1)
    expect(el.ownerDocument.activeElement).toBe(el)
    expect(f.raf).not.toHaveBeenCalled()
  })

  it('隠れている間は試し直し、見えたフレームで 1 回だけフォーカスして止まる', () => {
    const f = fakeFrames()
    const el = fakeInput(false)

    focusWhenReady(() => asEl(el), { raf: f.raf, caf: f.caf })
    expect(el.ownerDocument.activeElement).toBeNull()
    expect(f.pending()).toBe(1)

    f.tick() // まだ隠れている
    expect(el.ownerDocument.activeElement).toBeNull()
    expect(f.pending()).toBe(1)

    el.visible = true // React Flow が寸法を測り終えて見える状態になった
    f.tick()
    expect(el.ownerDocument.activeElement).toBe(el)
    expect(f.pending()).toBe(0)

    const calls = el.focus.mock.calls.length
    f.tick()
    f.tick()
    expect(el.focus).toHaveBeenCalledTimes(calls) // フォーカスを得たあとは触らない
  })

  it('要素がまだ無い（ref が未設定）間も試し直す', () => {
    const f = fakeFrames()
    const el = fakeInput(true)
    let target: HTMLElement | null = null

    focusWhenReady(() => target, { raf: f.raf, caf: f.caf })
    expect(f.pending()).toBe(1)

    target = asEl(el)
    f.tick()
    expect(el.ownerDocument.activeElement).toBe(el)
    expect(f.pending()).toBe(0)
  })

  it('maxFrames を超えたら諦める', () => {
    const f = fakeFrames()
    const el = fakeInput(false)

    focusWhenReady(() => asEl(el), { raf: f.raf, caf: f.caf, maxFrames: 3 })
    for (let i = 0; i < 10; i++) f.tick()

    expect(f.raf).toHaveBeenCalledTimes(3)
    expect(el.focus).toHaveBeenCalledTimes(4) // 最初の 1 回＋試し直し 3 回
    expect(f.pending()).toBe(0)
    expect(el.ownerDocument.activeElement).toBeNull()
  })

  it('すでにフォーカスがあれば focus() を呼ばない', () => {
    const f = fakeFrames()
    const el = fakeInput(true)
    el.ownerDocument.activeElement = el

    focusWhenReady(() => asEl(el), { raf: f.raf, caf: f.caf })

    expect(el.focus).not.toHaveBeenCalled()
    expect(f.raf).not.toHaveBeenCalled()
  })

  it('取り消すと、予約中のフレームは走らない', () => {
    const f = fakeFrames()
    const el = fakeInput(false)

    const cancel = focusWhenReady(() => asEl(el), { raf: f.raf, caf: f.caf })
    cancel()
    el.visible = true
    f.tick()

    expect(f.caf).toHaveBeenCalledTimes(1)
    expect(el.focus).toHaveBeenCalledTimes(1) // 最初の空振りだけ
    expect(el.ownerDocument.activeElement).toBeNull()
  })

  it('focusOptions をそのまま focus() へ渡す', () => {
    const f = fakeFrames()
    const el = fakeInput(true)

    focusWhenReady(() => asEl(el), {
      raf: f.raf,
      caf: f.caf,
      focusOptions: { preventScroll: true },
    })

    expect(el.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
