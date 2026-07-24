import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../storage/memoryStore'
import { ProfileRepository, ProfileSchema } from './index'

const makeRepo = () => new ProfileRepository(new MemoryStore())

describe('ProfileRepository', () => {
  it('未保存なら空オブジェクトを返す', async () => {
    expect(await makeRepo().get()).toEqual({})
  })

  it('保存した内容を読み戻せる（往復）', async () => {
    const repo = makeRepo()
    await repo.save({ penName: '夢野久作', avatar: 'data:image/jpeg;base64,AAAA' })
    expect(await repo.get()).toEqual({ penName: '夢野久作', avatar: 'data:image/jpeg;base64,AAAA' })
  })

  it('上書き保存できる', async () => {
    const repo = makeRepo()
    await repo.save({ penName: '旧名' })
    await repo.save({ penName: '新名' })
    expect(await repo.get()).toEqual({ penName: '新名' })
  })

  it('work:/snap:/trash: の prefix 検索に漏れない（衝突しない）', async () => {
    const store = new MemoryStore()
    const repo = new ProfileRepository(store)
    await repo.save({ penName: '著者' })
    expect(await store.keys('work:')).toEqual([])
  })
})

describe('ProfileSchema', () => {
  it('data URL でない avatar は弾く', () => {
    expect(() => ProfileSchema.parse({ avatar: 'https://example.com/a.png' })).toThrow()
  })

  it('penName のみ・avatar のみ・空でも通る', () => {
    expect(ProfileSchema.parse({})).toEqual({})
    expect(ProfileSchema.parse({ penName: 'A' })).toEqual({ penName: 'A' })
    expect(ProfileSchema.parse({ avatar: 'data:image/png;base64,AA' })).toEqual({
      avatar: 'data:image/png;base64,AA',
    })
  })
})
