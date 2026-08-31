import { z } from 'zod'

/**
 * ユーザー持ち込みのゲーム素材（07-novel-game.md §4.4）。
 *
 * G2 前半＝**この端末のローカル資産**（IndexedDB・全体バックアップに同乗）。
 * 実体はリサイズ済み画像の data URL（表紙・図鑑サムネと同じ方式）で、正本 Work には
 * 埋めない（D-GAME-ASSET-STORE）。R2 ホスティング（端末間で素材を運ぶ・grove 配信・有料）は
 * G2 後半で、このスキーマのまま実体の置き場所だけが増える。
 * 作品をまたいで使える（workId に紐づけない）。
 */
export const UserGameAssetSchema = z.object({
  id: z.string(),
  /** 将来 'bgm' | 'se' | 'sprite' を足す（後方互換のため enum に狭めない） */
  kind: z.literal('bg'),
  /** 一覧・クレジットに出す表示名（既定はファイル名） */
  name: z.string(),
  /** リサイズ済み画像の data URL */
  dataUrl: z.string().refine((s) => s.startsWith('data:image/'), 'data URL が必要'),
  /** 上・中・下の3色。共有カードの下地とクロスフェードの間の色に使う */
  tone: z.tuple([z.string(), z.string(), z.string()]),
  createdAt: z.number(),
})
export type UserGameAsset = z.infer<typeof UserGameAssetSchema>

/** Cue.bg / NovelGameOptions.defaultBg が指すアセットキー（'user:<id>'）。 */
export const userAssetKey = (id: string) => `user:${id}`

/** アセットキーが持ち込み素材か。 */
export const isUserAssetKey = (key: string) => key.startsWith('user:')

// ---------------------------------------------------------------------------
// クラウド保管（R2 ホスティング・G2 後半・有料）
// ---------------------------------------------------------------------------

/**
 * クラウドに保管できる枚数の上限（1 アカウントあたり・素材の種別を合わせて数える）。
 * D-GAME-PRICE の「独自素材のホスティングは有料」の枠。値付けと連動して変えるならここ1箇所。
 */
export const HOSTED_ASSET_LIMIT = 30

/**
 * 1 素材の上限バイト数（data URL 文字列長で判定）。リサイズ済みの持ち込み画像は
 * 通常 100〜300 KB なので、正常系では届かない安全弁。
 */
export const HOSTED_ASSET_MAX_BYTES = 1_500_000

export type HostedAssetVerdict = 'ok' | 'too_large' | 'limit_reached'

/**
 * クラウドへ保存できるかの判定（サーバ・クライアント共通の単一の真実）。
 * 同じ id の置き換え（上書き）は枚数に数えない。
 */
export function hostedAssetVerdict(
  asset: Pick<UserGameAsset, 'id' | 'dataUrl'>,
  existingIds: Iterable<string>,
): HostedAssetVerdict {
  if (asset.dataUrl.length > HOSTED_ASSET_MAX_BYTES) return 'too_large'
  const ids = new Set(existingIds)
  if (!ids.has(asset.id) && ids.size >= HOSTED_ASSET_LIMIT) return 'limit_reached'
  return 'ok'
}
