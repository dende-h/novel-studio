import type { UserGameAsset } from '@/core/game/assets'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import {
  deleteHostedAsset,
  getHostedAsset,
  type HostedAssetMeta,
  type HostedPutResult,
  listHostedAssets,
  putHostedAsset,
} from '@/ui/_api/game-assets'

/**
 * 持ち込み素材のクラウド保管（R2 ホスティング・会員のみ）の配線。
 * ローカル（IndexedDB）が常に正で、クラウドは「ほかの端末へ運ぶ」ための控え：
 * - 下り（pullHostedAssets）… クラウドにあってこの端末に無い分を取り込む。演出エディタが開いたときに走る。
 * - 上り … 素材を追加した瞬間と、管理画面の明示操作だけ。**一括アップロードはしない**
 *   （別端末で削除済みの素材を、残った端末が黙って復活させないため）。
 */

export interface AssetHostingApi {
  list(): Promise<HostedAssetMeta[] | null>
  get(id: string): Promise<UserGameAsset | null>
  put(asset: UserGameAsset): Promise<HostedPutResult>
  remove(id: string): Promise<boolean>
}

/** 本番用：`/api/game-assets` クライアントを Clerk JWT で結線する。 */
export function createAssetHostingApi(getToken: () => Promise<string | null>): AssetHostingApi {
  return {
    list: () => listHostedAssets(getToken),
    get: (id) => getHostedAsset(getToken, id),
    put: (asset) => putHostedAsset(getToken, asset),
    remove: (id) => deleteHostedAsset(getToken, id),
  }
}

export interface PullResult {
  /** この端末に無くて、クラウドから取り込んだ素材（新しい順ではなく取得順）。 */
  added: UserGameAsset[]
  /** クラウドに保管中の素材 id（管理画面のバッジ用）。 */
  hostedIds: Set<string>
}

/**
 * クラウドにあってこの端末に無い素材を取り込む（下り）。一覧が取れなければ null
 * （未ログイン・通信不良——ローカルだけで動き続ける）。1 件の取得失敗は飛ばして続ける。
 */
export async function pullHostedAssets(
  repo: Pick<GameAssetRepository, 'list' | 'save'>,
  api: Pick<AssetHostingApi, 'list' | 'get'>,
): Promise<PullResult | null> {
  const remote = await api.list()
  if (remote === null) return null
  const localIds = new Set((await repo.list()).map((a) => a.id))
  const added: UserGameAsset[] = []
  for (const meta of remote) {
    if (localIds.has(meta.id)) continue
    const asset = await api.get(meta.id)
    if (!asset || asset.id !== meta.id) continue
    await repo.save(asset)
    added.push(asset)
  }
  return { added, hostedIds: new Set(remote.map((m) => m.id)) }
}
