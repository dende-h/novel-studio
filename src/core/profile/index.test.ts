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

  it('アカウントの印は別のキーに置き、profile の中身を変えない', async () => {
    // `profile` は端末間で同期され（profile:me）、canonical JSON のハッシュで
    // 差分を判定する。ここへ欄を増やすと、**まだ更新していない端末**が知らないキーを
    // 落として押し返す（Zod は未知のキーを捨てる）＝押し合いになる。だから器を分ける。
    const store = new MemoryStore()
    const repo = new ProfileRepository(store)
    await repo.save({ penName: '著者', updatedAt: 100 })
    await repo.saveAccountId('user_1')

    expect(await repo.getAccountId()).toBe('user_1')
    await expect(store.get('profile')).resolves.toEqual({ penName: '著者', updatedAt: 100 })
    expect(JSON.stringify(await repo.get())).toBe('{"penName":"著者","updatedAt":100}')
  })

  it('印は消せる（別アカウントの名前を伏せたとき）', async () => {
    const repo = makeRepo()
    await repo.saveAccountId('user_1')
    await repo.saveAccountId(undefined)
    expect(await repo.getAccountId()).toBeUndefined()
  })
})

describe('ProfileSchema', () => {
  it('知らないキーは落ちる＝同期の canonical JSON が増えない', () => {
    // 旧版の端末が新しいキーを落として押し返すのと同じ挙動。ここを固定しておけば、
    // うっかり Profile に欄を足したときに「同期が揺れる」ことに気づける。
    expect(ProfileSchema.parse({ penName: 'A', accountId: 'user_1' })).toEqual({ penName: 'A' })
  })

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
