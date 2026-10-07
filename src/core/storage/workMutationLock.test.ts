import { describe, expect, it, vi } from 'vitest'
import { withWorkMutationLock } from './workMutationLock'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
describe('workMutationLock', () => {
  it('同一作品を直列化し、別作品は独立する', async () => {
    const gate = deferred()
    const order: string[] = []
    const first = withWorkMutationLock('a', async () => {
      order.push('first')
      await gate.promise
    })
    const second = withWorkMutationLock('a', async () => {
      order.push('second')
    })
    await withWorkMutationLock('b', async () => {
      order.push('other')
    })
    expect(order).toEqual(['first', 'other'])
    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'other', 'second'])
  })
  it('失敗後もキューを再開する', async () => {
    await expect(
      withWorkMutationLock('failed', async () => {
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')
    await expect(withWorkMutationLock('failed', async () => 42)).resolves.toBe(42)
  })
  it('Web Locksがあると共有名で取得する', async () => {
    const request = vi.fn(async (_name, fn) => fn())
    vi.stubGlobal('navigator', { locks: { request } })
    try {
      expect(await withWorkMutationLock('web', async () => 1)).toBe(1)
      expect(request).toHaveBeenCalledWith('novel-studio:work:web', expect.any(Function))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
