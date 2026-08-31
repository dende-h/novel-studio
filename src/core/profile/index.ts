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
  // 端末間 LWW 用の最終更新時刻（epoch ms）。クラウド同期で勝者を決めるのに使う。
  updatedAt: z.number().optional(),
})
export type Profile = z.infer<typeof ProfileSchema>

/** プロフィールの保存キー（KeyValueStore の単一キー）。work:/snap:/trash: と衝突しない。 */
const KEY = 'profile'

/**
 * 「いまのペンネームが誰のものか」の印の保存キー。**`profile` とは別のキーにする**。
 *
 * `Profile` は端末間で同期され（`profile:me`・LWW）、クラウドバックアップにも入る。
 * そこへ欄を足すと canonical JSON が変わってハッシュがずれ、**まだ更新していない端末**が
 * 知らない欄を落として押し返す（Zod は未知のキーを捨てる）＝更新済みの端末と押し合いになる。
 * この印は「この端末の写しがどのアカウントのものか」という**端末の帳簿**で、
 * 同期にもバックアップにも乗せる理由がない。だから器ごと分ける。
 */
const ACCOUNT_KEY = 'profile-account'

const ProfileAccountSchema = z.object({ accountId: z.string().optional() })

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

  /**
   * いまのペンネームが属するアカウント（Clerk userId）。**未設定は「まだどの
   * アカウントのものでもない」**（サインイン前に決めた名前・この印より前に保存された行）。
   * 判定は `penNameForAccount`（`./account.ts`）。
   */
  async getAccountId(): Promise<string | undefined> {
    const raw = await this.store.get(ACCOUNT_KEY)
    return raw === undefined ? undefined : ProfileAccountSchema.parse(raw).accountId
  }

  async saveAccountId(accountId: string | undefined): Promise<void> {
    await this.store.set(ACCOUNT_KEY, ProfileAccountSchema.parse({ accountId }))
  }
}
