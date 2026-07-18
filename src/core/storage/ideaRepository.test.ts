import { beforeEach, describe, expect, it } from 'vitest'
import { IdeaRepository } from './ideaRepository'
import type { KeyValueStore } from './types'

/** メモリ実装の KeyValueStore。 */
function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => {
      m.set(k, v)
    },
    delete: async (k) => {
      m.delete(k)
    },
    keys: async (prefix?: string) =>
      [...m.keys()].filter((k) => (prefix ? k.startsWith(prefix) : true)),
  }
}

/** add の戻りが null でないことを保証してメモを取り出す。 */
async function addOrThrow(repo: IdeaRepository, text: string) {
  const n = await repo.add(text)
  if (!n) throw new Error(`add failed for: ${text}`)
  return n
}

describe('IdeaRepository（ネタ帳の永続化）', () => {
  let repo: IdeaRepository
  beforeEach(() => {
    let n = 0
    let clock = 1000
    repo = new IdeaRepository(
      memStore(),
      () => `id-${++n}`,
      () => (clock += 1000),
    )
  })

  it('add はテキストを trim して 1 メモとして保存する', async () => {
    const note = await addOrThrow(repo, '  ネタA  ')
    expect(note).toMatchObject({ id: 'id-1', text: 'ネタA' })
    expect(note.createdAt).toBe(note.updatedAt)
  })

  it('空白のみの add は null を返し保存しない', async () => {
    expect(await repo.add('   ')).toBeNull()
    expect(await repo.list()).toHaveLength(0)
  })

  it('list は作成日時の新しい順で返す', async () => {
    await repo.add('古い')
    await repo.add('新しい')
    const rows = await repo.list()
    expect(rows.map((r) => r.text)).toEqual(['新しい', '古い'])
  })

  it('update は本文を書き換え updatedAt を進める', async () => {
    const a = await addOrThrow(repo, '元')
    const updated = await repo.update(a.id, '  書き換え  ')
    expect(updated?.text).toBe('書き換え')
    expect(updated?.updatedAt).toBeGreaterThan(a.createdAt)
  })

  it('update は空文字や存在しない id では null', async () => {
    const a = await addOrThrow(repo, '元')
    expect(await repo.update(a.id, '   ')).toBeNull()
    expect(await repo.update('missing', 'x')).toBeNull()
  })

  it('remove はメモを削除する', async () => {
    const a = await addOrThrow(repo, '消す')
    await repo.remove(a.id)
    expect(await repo.list()).toHaveLength(0)
  })

  it('replaceAll は既存を消してから全置換する（クラウド復元）', async () => {
    await repo.add('残らない')
    await repo.replaceAll([
      { id: 'x1', text: 'A', createdAt: 5, updatedAt: 5 },
      { id: 'x2', text: 'B', createdAt: 9, updatedAt: 9 },
    ])
    const rows = await repo.list()
    expect(rows.map((r) => r.id)).toEqual(['x2', 'x1']) // 残らない は消えている
  })
})
