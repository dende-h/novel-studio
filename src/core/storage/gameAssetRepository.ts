import type { UserGameAsset } from '../game/assets'
import type { KeyValueStore } from './types'

/**
 * ユーザー持ち込みのゲーム素材（背景画像）の永続化。
 * KeyValueStore に `gameasset:<id>` で 1 素材 1 レコード。純ローカル（同期に載せない——
 * 端末間で素材を運ぶのは G2 後半の R2 ホスティング）。全体バックアップには同乗する。
 */
const PREFIX = 'gameasset:'
const keyOf = (id: string) => `${PREFIX}${id}`

export class GameAssetRepository {
  constructor(private store: KeyValueStore) {}

  async get(id: string): Promise<UserGameAsset | undefined> {
    return (await this.store.get<UserGameAsset>(keyOf(id))) ?? undefined
  }

  async save(asset: UserGameAsset): Promise<void> {
    await this.store.set(keyOf(asset.id), asset)
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 全件（新しい順。素材選択とバックアップ用）。 */
  async list(): Promise<UserGameAsset[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map((k) => this.store.get<UserGameAsset>(k)))
    return rows
      .filter((r): r is UserGameAsset => r != null)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 全置換する（クラウド／ローカル両バックアップの復元用）。 */
  async replaceAll(assets: UserGameAsset[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(assets.map((a) => this.save(a)))
  }
}
