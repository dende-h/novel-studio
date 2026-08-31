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
