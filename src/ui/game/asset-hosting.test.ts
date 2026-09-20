import { describe, expect, it } from 'vitest'
import type { UserGameAsset } from '@/core/game/assets'
import { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { type AssetHostingApi, pullHostedAssets } from './asset-hosting'

function asset(id: string, name = id): UserGameAsset {
  return {
    id,
    kind: 'bg',
    name,
    dataUrl: 'data:image/webp;base64,SGk=',
    tone: ['#111111', '#222222', '#333333'],
    createdAt: 1,
  }
}

function fakeApi(remote: UserGameAsset[], opts: { listFails?: boolean } = {}) {
  const got: string[] = []
  const api: Pick<AssetHostingApi, 'list' | 'get'> = {
    list: async () =>
      opts.listFails ? null : remote.map((a) => ({ id: a.id, size: a.dataUrl.length })),
    get: async (id) => {
      got.push(id)
      return remote.find((a) => a.id === id) ?? null
    },
  }
  return { api, got }
}

describe('pullHostedAssets（クラウド → この端末の下り取り込み）', () => {
  it('この端末に無い素材だけをダウンロードして保存する', async () => {
    const repo = new GameAssetRepository(new MemoryStore())
    await repo.save(asset('local-1'))
    const { api, got } = fakeApi([asset('local-1'), asset('cloud-1', '海辺')])

    const res = await pullHostedAssets(repo, api)
    expect(res).not.toBeNull()
    expect(got).toEqual(['cloud-1']) // 手元にある分は取りに行かない
    expect(res?.added.map((a) => a.name)).toEqual(['海辺'])
    expect((await repo.list()).map((a) => a.id).sort()).toEqual(['cloud-1', 'local-1'])
    expect([...(res?.hostedIds ?? [])].sort()).toEqual(['cloud-1', 'local-1'])
  })

  it('一覧が取れなければ null（ローカルには触れない）', async () => {
    const repo = new GameAssetRepository(new MemoryStore())
    await repo.save(asset('local-1'))
    const { api } = fakeApi([], { listFails: true })
    expect(await pullHostedAssets(repo, api)).toBeNull()
    expect((await repo.list()).map((a) => a.id)).toEqual(['local-1'])
  })

  it('1 件の取得失敗は飛ばして残りを取り込む', async () => {
    const repo = new GameAssetRepository(new MemoryStore())
    const remote = [asset('cloud-1'), asset('cloud-2')]
    const api: Pick<AssetHostingApi, 'list' | 'get'> = {
      list: async () => remote.map((a) => ({ id: a.id, size: 1 })),
      get: async (id) => (id === 'cloud-1' ? null : (remote.find((a) => a.id === id) ?? null)),
    }
    const res = await pullHostedAssets(repo, api)
    expect(res?.added.map((a) => a.id)).toEqual(['cloud-2'])
    expect((await repo.list()).map((a) => a.id)).toEqual(['cloud-2'])
  })
})
