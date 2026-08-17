// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '@/core/storage/memoryStore'
import { StructureRepository } from '@/core/storage/structureRepository'
import type { Structure } from '@/core/structure'
import { ensurePrimaryStructure } from './ensure-structure'

/**
 * 同期レースで生まれた「新しくて空」の重複に対して、内容を持つ構造が常に表示され、
 * 空の重複が掃除されることの回帰テスト（stg で「アウトライン/マインドマップが消えた」件）。
 */

const mk = (
  over: Partial<Structure> & Pick<Structure, 'id' | 'kind' | 'updatedAt'>,
): Structure => ({
  workId: 'w1',
  nodes: [],
  edges: [],
  ...over,
})

const note = (id: string, label: string) => ({ id, kind: 'note' as const, label })

function makeRepo() {
  const store = new MemoryStore()
  return new StructureRepository(
    store,
    () => 'gen-id',
    () => 999,
  )
}

describe('ensurePrimaryStructure', () => {
  it('「新しくて空」より内容を持つ構造を優先し、空の重複を掃除する', async () => {
    const repo = makeRepo()
    await repo.put(mk({ id: 'old', kind: 'outline', updatedAt: 100, nodes: [note('n1', 'メモ')] }))
    await repo.put(mk({ id: 'empty-new', kind: 'outline', updatedAt: 900 })) // 同期レースの残骸

    const picked = await ensurePrimaryStructure(repo, 'w1', 'outline')
    expect(picked.id).toBe('old') // 内容優先＝「消えた」内容が戻る
    expect(await repo.get('empty-new')).toBeUndefined() // 空の重複は削除（同期で伝播）
  })

  it('内容を持つ重複は消さない（手動で救えるよう残す）', async () => {
    const repo = makeRepo()
    await repo.put(
      mk({ id: 'a', kind: 'mindmap', updatedAt: 100, nodes: [note('n1', 'あ'), note('n2', 'い')] }),
    )
    await repo.put(mk({ id: 'b', kind: 'mindmap', updatedAt: 900, nodes: [note('n3', 'う')] }))

    const picked = await ensurePrimaryStructure(repo, 'w1', 'mindmap')
    expect(picked.id).toBe('a') // ノード数が多い方
    expect(await repo.get('b')).toBeDefined()
  })

  it('マインドマップの「空ラベル中心ノード 1 つだけ」も空とみなして掃除する', async () => {
    const repo = makeRepo()
    await repo.put(mk({ id: 'real', kind: 'mindmap', updatedAt: 100, nodes: [note('n1', '主題')] }))
    await repo.put(mk({ id: 'stub', kind: 'mindmap', updatedAt: 900, nodes: [note('c', '')] }))

    const picked = await ensurePrimaryStructure(repo, 'w1', 'mindmap')
    expect(picked.id).toBe('real')
    expect(await repo.get('stub')).toBeUndefined()
  })

  it('1 つも無ければ決定的 id（workId:kind）で生成する＝どの端末でも同じレコードに収束', async () => {
    const repo = makeRepo()
    const created = await ensurePrimaryStructure(repo, 'w1', 'outline', 'アウトライン')
    expect(created.id).toBe('w1:outline')
    // 別端末（別インスタンス）でも同じ id になる
    const repo2 = makeRepo()
    const created2 = await ensurePrimaryStructure(repo2, 'w1', 'outline')
    expect(created2.id).toBe('w1:outline')
  })

  it('別 kind の構造には影響しない', async () => {
    const repo = makeRepo()
    await repo.put(mk({ id: 'chart1', kind: 'chart', updatedAt: 900 })) // 空だが kind 違い
    await repo.put(mk({ id: 'ol', kind: 'outline', updatedAt: 100, nodes: [note('n', 'x')] }))
    await ensurePrimaryStructure(repo, 'w1', 'outline')
    expect(await repo.get('chart1')).toBeDefined()
  })
})
