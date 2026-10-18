import { beforeEach, describe, expect, it } from 'vitest'
import type { NameDismissals } from '../proofread/name-dismissals'
import { MemoryStore } from './memoryStore'
import { NameDismissalRepository } from './nameDismissalRepository'
import { ProofreadRepository } from './proofreadRepository'

const record = (workId: string, updatedAt = 100): NameDismissals => ({
  workId,
  words: [{ text: '新宿', at: updatedAt }],
  updatedAt,
})

describe('NameDismissalRepository（候補から外した語の永続化・COT-59）', () => {
  let store: MemoryStore
  let repo: NameDismissalRepository
  beforeEach(() => {
    store = new MemoryStore()
    repo = new NameDismissalRepository(store)
  })

  it('作品ごとに保存して読み出す（キーは proofread-names:<workId>）', async () => {
    await repo.save(record('w1'))
    expect(await repo.get('w1')).toEqual(record('w1'))
    expect(await store.keys('proofread-names:')).toEqual(['proofread-names:w1'])
    expect(await repo.get('w2')).toBeUndefined()
  })

  it('壊れたレコードは list では外し、listRaw では id ごと返す（消さない）', async () => {
    await repo.save(record('w1'))
    await store.set('proofread-names:w2', { workId: 'w2', words: 'broken' })
    expect((await repo.list()).map((r) => r.workId)).toEqual(['w1'])
    expect((await repo.listRaw()).map((r) => r.id).sort()).toEqual(['w1', 'w2'])
    expect(await repo.getById('w2')).toBeUndefined()
    expect(await store.get('proofread-names:w2')).toBeTruthy()
  })

  it('removeByWork はその作品の記録だけを消す', async () => {
    await repo.save(record('w1'))
    await repo.save(record('w2'))
    await repo.removeByWork('w1')
    expect((await repo.list()).map((r) => r.workId)).toEqual(['w2'])
  })

  it('replaceAll は外した語の記録だけを置き換える', async () => {
    await repo.save(record('w1'))
    await repo.replaceAll([record('w3')])
    expect((await repo.list()).map((r) => r.workId)).toEqual(['w3'])
  })

  it('推敲の判断の復元（ProofreadRepository.replaceAll）で消えない', async () => {
    await repo.save(record('w1'))
    await new ProofreadRepository(store).replaceAll([])
    expect(await repo.get('w1')).toEqual(record('w1'))
  })
})
