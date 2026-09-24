import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSerialSave } from './use-serial-save'

/**
 * 「最新の状態に積み、保存は 1 本ずつ」。関心は、保存の await 中に次の変更が来ても
 * 先の変更が黙って消えないこと（プロットの要約が状態ボタンで消えた不具合の再発防止）。
 * 保存はテストが手で解く偽物にして、わざと遅れて解決させる。
 */

interface Doc {
  summary?: string
  status: string
  rev: number
}

/** 呼ばれた順に止めておき、resolveNext / rejectNext で 1 件ずつ解く偽の保存。 */
function slowSave() {
  const waiting: Array<{ doc: Doc; resolve: (d: Doc) => void; reject: (e: Error) => void }> = []
  let rev = 0
  const save = vi.fn(
    (doc: Doc) =>
      new Promise<Doc>((resolve, reject) => {
        waiting.push({ doc, resolve, reject })
      }),
  )
  const settle = async (ok: boolean) => {
    // 保存は前の保存の Promise につないで呼ばれるので、呼ばれるまでマイクロタスクを流す。
    await act(async () => {})
    const next = waiting.shift()
    if (!next) throw new Error('保存待ちがありません')
    await act(async () => {
      if (ok) next.resolve({ ...next.doc, rev: ++rev })
      else next.reject(new Error('書き込みに失敗'))
    })
  }
  return {
    save,
    resolveNext: () => settle(true),
    rejectNext: () => settle(false),
  }
}

const BASE: Doc = { status: 'idea', rev: 0 }

function setup() {
  const s = slowSave()
  const hook = renderHook(() => useSerialSave<Doc>(s.save))
  act(() => hook.result.current.reset(BASE))
  return { ...s, hook, current: () => hook.result.current }
}

describe('useSerialSave（最新に積んで直列に保存）', () => {
  it('await を挟まずに続けた変更は、後の変更が前の変更に積まれて両方とも保存される', async () => {
    const { current, save, resolveNext } = setup()
    let a!: Promise<void>
    let b!: Promise<void>
    act(() => {
      a = current().apply((d) => ({ ...d, summary: '主人公が村を出る' }))
      b = current().apply((d) => ({ ...d, status: 'fixed' }))
    })
    await resolveNext()
    await resolveNext()
    await act(() => Promise.all([a, b]))

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ summary: '主人公が村を出る', status: 'fixed' })
    expect(current().value).toMatchObject({ summary: '主人公が村を出る', status: 'fixed' })
  })

  it('保存は 1 本ずつ：前の保存が終わるまで次の保存を始めない', async () => {
    const { current, save, resolveNext } = setup()
    act(() => {
      void current().apply((d) => ({ ...d, summary: 'a' }))
      void current().apply((d) => ({ ...d, status: 'fixed' }))
    })
    await act(async () => {})
    expect(save).toHaveBeenCalledTimes(1)
    await resolveNext()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('表示は最後の変更の保存が返した値で揃え、途中の保存結果で巻き戻らない', async () => {
    const { current, resolveNext } = setup()
    act(() => {
      void current().apply((d) => ({ ...d, summary: 'a' }))
      void current().apply((d) => ({ ...d, status: 'fixed' }))
    })
    await resolveNext()
    // 1 本目（要約だけ）の結果は表示に出さない＝状態ボタンの表示が一瞬戻ったりしない。
    expect(current().value).toEqual(BASE)
    await resolveNext()
    expect(current().value).toEqual({ summary: 'a', status: 'fixed', rev: 2 })
  })

  it('fn が同じ値を返したら（no-op）保存しない', async () => {
    const { current, save } = setup()
    await act(() => current().apply((d) => d))
    expect(save).not.toHaveBeenCalled()
  })

  it('値が無い（読み込み前）あいだの変更は何もしない', async () => {
    const s = slowSave()
    const { result } = renderHook(() => useSerialSave<Doc>(s.save))
    await act(() => result.current.apply((d) => ({ ...d, status: 'fixed' })))
    expect(s.save).not.toHaveBeenCalled()
    expect(result.current.value).toBeNull()
  })

  it('最後の変更の保存が失敗したら、最後に保存できた値へ戻り、次の変更はそこへ積む', async () => {
    const { current, save, resolveNext, rejectNext } = setup()
    let failed!: Promise<void>
    act(() => {
      void current().apply((d) => ({ ...d, summary: 'a' }))
      failed = current().apply((d) => ({ ...d, status: 'fixed' }))
    })
    await resolveNext()
    await rejectNext()
    await expect(failed).rejects.toThrow('書き込みに失敗')
    expect(current().value).toEqual({ summary: 'a', status: 'idea', rev: 1 })

    // 失敗しても列は止まらない。
    act(() => {
      void current().apply((d) => ({ ...d, status: 'writing' }))
    })
    await act(async () => {})
    expect(save).toHaveBeenCalledTimes(3)
    expect(save.mock.calls[2]?.[0]).toMatchObject({ summary: 'a', status: 'writing' })
  })

  it('途中の保存が失敗しても、後の変更の保存が成功すればその変更ごと残る', async () => {
    const { current, resolveNext, rejectNext } = setup()
    let failed!: Promise<void>
    act(() => {
      failed = current().apply((d) => ({ ...d, summary: 'a' }))
      void current().apply((d) => ({ ...d, status: 'fixed' }))
    })
    await rejectNext()
    await expect(failed).rejects.toThrow()
    await resolveNext()
    expect(current().value).toMatchObject({ summary: 'a', status: 'fixed' })
  })

  it('receive：保存待ちの変更があるあいだは取り込まず、済めば取り込む', async () => {
    const { current, resolveNext } = setup()
    act(() => {
      void current().apply((d) => ({ ...d, summary: 'a' }))
    })
    const pulled: Doc = { status: 'done', rev: 99 }
    let took = true
    act(() => {
      took = current().receive(() => pulled)
    })
    expect(took).toBe(false)
    await resolveNext()
    expect(current().value).toMatchObject({ summary: 'a' })

    act(() => {
      took = current().receive(() => pulled)
    })
    expect(took).toBe(true)
    expect(current().value).toBe(pulled)
    // 取り込んだ値が次の変更の土台になる。
    act(() => {
      void current().apply((d) => ({ ...d, summary: 'b' }))
    })
    await resolveNext()
    expect(current().value).toMatchObject({ status: 'done', summary: 'b' })
  })

  it('reset：それより前に投げた保存の結果で表示を上書きしない（作品の切り替え等）', async () => {
    const { current, resolveNext } = setup()
    act(() => {
      void current().apply((d) => ({ ...d, summary: '前の作品' }))
    })
    const other: Doc = { status: 'idea', summary: '次の作品', rev: 0 }
    act(() => current().reset(other))
    await resolveNext()
    expect(current().value).toBe(other)
  })
})
