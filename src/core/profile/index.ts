import { z } from 'zod'
import type { KeyValueStore } from '../storage/types'

/**
 * 作者プロフィール（ペンネーム・アバター）。端末ローカルに1件だけ持つ。
 * 新規作品作成時の著者デフォルト・ヘッダとサイドバーの表示・掲示板の表示名に使う。
 * Work とは独立した永続化。
 */
export const ProfileSchema = z.object({
  penName: z.string().optional(),
  // アバター画像（リサイズ済み JPEG の data URL）。1枚・任意。
  avatar: z
    .string()
    .refine((s) => s.startsWith('data:image/'), 'data URL が必要')
    .optional(),
  /**
   * このペンネームが属するアカウント（Clerk userId）。**未設定は「まだどの
   * アカウントのものでもない」**（サインイン前に決めた名前・旧バージョンで保存された行）。
   *
   * ローカル 1 件しか持たない器にアカウントの印を足すのは、**アカウントを切り替えても
   * 名前が変わらない**問題を直すため。端末の値が誰のものかを覚えていないと、別の
   * アカウントでサインインしても前の人のペンネームが出たままになる（`penNameForAccount`）。
   * 判定にしか使わないので、あとから足しても既存の行は optional のまま読める。
   */
  accountId: z.string().optional(),
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
