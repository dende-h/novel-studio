import { z } from 'zod'
import type { KeyValueStore } from '../storage/types'

/**
 * 作者プロフィール（ペンネーム・アバター）。端末ローカルに1件だけ持つ。
 * 新規作品作成時の著者デフォルトとサイドバー表示に使う。Work とは独立した永続化。
 */
export const ProfileSchema = z.object({
  penName: z.string().optional(),
  // アバター画像（リサイズ済み JPEG の data URL）。1枚・任意。
  avatar: z
    .string()
    .refine((s) => s.startsWith('data:image/'), 'data URL が必要')
    .optional(),
  // 端末間 LWW 用の最終更新時刻（epoch ms）。クラウド同期で勝者を決めるのに使う。
  updatedAt: z.number().optional(),
})
export type Profile = z.infer<typeof ProfileSchema>

/** プロフィールの保存キー（KeyValueStore の単一キー）。work:/snap:/trash: と衝突しない。 */
const KEY = 'profile'

/** プロフィールの永続化リポジトリ（KeyValueStore の単一キー `profile`）。 */
export class ProfileRepository {
  constructor(private store: KeyValueStore) {}

  /** 保存済みプロフィール（未設定なら空オブジェクト）。 */
  async get(): Promise<Profile> {
    const raw = await this.store.get(KEY)
    return raw === undefined ? {} : ProfileSchema.parse(raw)
  }

  async save(profile: Profile): Promise<void> {
    await this.store.set(KEY, ProfileSchema.parse(profile))
  }
}
