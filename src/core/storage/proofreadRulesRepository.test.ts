import { beforeEach, describe, expect, it } from 'vitest'
import type { ProofreadRules } from '../proofread/work-rules'
import { MemoryStore } from './memoryStore'
import { NameDismissalRepository } from './nameDismissalRepository'
import { ProofreadRepository } from './proofreadRepository'
import { ProofreadRulesRepository } from './proofreadRulesRepository'

const record = (workId: string, updatedAt = 100): ProofreadRules => ({
  workId,
  exceptions: [{ key: 'ra-nuki:見れる', label: '見れる', at: updatedAt }],
  preferences: [],
  declined: [],
  updatedAt,
})

describe('ProofreadRulesRepository（作品の決まりの永続化・COT-62）', () => {
  let store: MemoryStore
  let repo: ProofreadRulesRepository
  beforeEach(() => {
    store = new MemoryStore()
    repo = new ProofreadRulesRepository(store)
  })

  it('作品ごとに保存して読み出す（キーは proofread-rules:<workId>）', async () => {
    await repo.save(record('w1'))
    expect(await repo.get('w1')).toEqual(record('w1'))
    expect(await store.keys('proofread-rules:')).toEqual(['proofread-rules:w1'])
    expect(await repo.get('w2')).toBeUndefined()
  })

  it('壊れたレコードは list では外し、listRaw では id ごと返す（消さない）', async () => {
    await repo.save(record('w1'))
    await store.set('proofread-rules:w2', { workId: 'w2', exceptions: 'broken' })
    expect((await repo.list()).map((r) => r.workId)).toEqual(['w1'])
    expect((await repo.listRaw()).map((r) => r.id).sort()).toEqual(['w1', 'w2'])
    expect(await repo.getById('w2')).toBeUndefined()
    expect(await store.get('proofread-rules:w2')).toBeTruthy()
  })

  it('removeByWork はその作品の記録だけを消す', async () => {
    await repo.save(record('w1'))
    await repo.save(record('w2'))
    await repo.removeByWork('w1')
    expect((await repo.list()).map((r) => r.workId)).toEqual(['w2'])
  })

  it('replaceAll は決まりの記録だけを置き換える', async () => {
    await repo.save(record('w1'))
    await repo.replaceAll([record('w3')])
    expect((await repo.list()).map((r) => r.workId)).toEqual(['w3'])
  })

  it('推敲の判断・外した語の復元で消えない', async () => {
    await repo.save(record('w1'))
    await new ProofreadRepository(store).replaceAll([])
    await new NameDismissalRepository(store).replaceAll([])
    expect(await repo.get('w1')).toEqual(record('w1'))
  })
})
