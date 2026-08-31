import { z } from 'zod'

/**
 * ユーザー持ち込みのゲーム素材（07-novel-game.md §4.4）。
 *
 * この端末のローカル資産（IndexedDB・全体バックアップに同乗）が正で、会員は
 * R2 ホスティング（G2 後半）に控えを置ける。実体はリサイズ済み画像の data URL
 * （表紙・図鑑サムネと同じ方式）で、正本 Work には埋めない（D-GAME-ASSET-STORE）。
 * 作品をまたいで使える（workId に紐づけない）。
 */
export const UserGameAssetSchema = z.object({
  id: z.string(),
  /** 将来 'bgm' | 'se' を足すときもここへ（旧クライアントは未知 kind の素材を扱えないだけ） */
  kind: z.enum(['bg', 'sprite']),
  /** 一覧・クレジットに出す表示名（既定はファイル名） */
  name: z.string(),
  /** リサイズ済み画像の data URL */
  dataUrl: z.string().refine((s) => s.startsWith('data:image/'), 'data URL が必要'),
  /** 上・中・下の3色。共有カードの下地とクロスフェードの間の色に使う（立ち絵では未使用） */
  tone: z.tuple([z.string(), z.string(), z.string()]),
  /** 立ち絵のみ：この立ち絵の人物（Cue.speaker と同じ文字列で突き合わせる） */
  character: z.string().optional(),
  /** 立ち絵のみ：表情名（省略は DEFAULT_EXPRESSION 扱い） */
  expression: z.string().optional(),
  /**
   * テンプレ由来ならそのキー（'preset:sprite/…'）。id は `tpl-` 前置で作り、
   * 持ち込み枚数・クラウド保管の枚数どちらにも数えない（無料でも使える）。
   */
  preset: z.string().optional(),
  createdAt: z.number(),
})
export type UserGameAsset = z.infer<typeof UserGameAssetSchema>

/** Cue.bg / NovelGameOptions.defaultBg が指すアセットキー（'user:<id>'）。 */
export const userAssetKey = (id: string) => `user:${id}`

/** アセットキーが持ち込み素材か。 */
export const isUserAssetKey = (key: string) => key.startsWith('user:')

// ---------------------------------------------------------------------------
// 立ち絵（sprite・G2 のオプション＝D-GAME-NOSPRITE）
// ---------------------------------------------------------------------------

/** 表情名を省略したときの既定（「通常」の顔）。 */
export const DEFAULT_EXPRESSION = '通常'

/** 立ち絵の選定に必要な形（core の UserGameAsset と exporter 入力の両方が満たす）。 */
export interface SpriteSource {
  id: string
  kind?: string
  character?: string
  expression?: string
  createdAt?: number
}

/** speaker に紐づく立ち絵（登録の古い順・同時刻は id 順）。 */
export function spritesOfSpeaker<T extends SpriteSource>(
  assets: readonly T[],
  speaker: string,
): T[] {
  return assets
    .filter((a) => a.kind === 'sprite' && a.character === speaker)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
}

/** speaker の立ち絵にある表情名（重複なし・登録の古い順）。UI の選択肢と MCP の検証に使う。 */
export function spriteExpressionsOf(assets: readonly SpriteSource[], speaker: string): string[] {
  const out: string[] = []
  for (const a of spritesOfSpeaker(assets, speaker)) {
    const e = a.expression?.trim() || DEFAULT_EXPRESSION
    if (!out.includes(e)) out.push(e)
  }
  return out
}

/**
 * 表示する立ち絵を 1 枚選ぶ。表情の指定が無い／見つからないときは
 * 「通常」→ 最初に登録した 1 枚、の順に倒す（**選べる限り必ず出す**＝壊さない）。
 */
export function pickSprite<T extends SpriteSource>(
  assets: readonly T[],
  speaker: string,
  expression?: string,
): T | undefined {
  const candidates = spritesOfSpeaker(assets, speaker)
  if (candidates.length === 0) return undefined
  const byExpr = (e: string) =>
    candidates.find((a) => (a.expression?.trim() || DEFAULT_EXPRESSION) === e)
  const wanted = expression?.trim()
  return (wanted ? byExpr(wanted) : undefined) ?? byExpr(DEFAULT_EXPRESSION) ?? candidates[0]
}

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
 * テンプレ由来の割り当てレコードか（id の形で判定＝サーバは中身を復号せずに数えられる）。
 * 実体が数 KB の SVG なので、持ち込み・クラウド保管どちらの枚数にも数えない。
 */
export const isTemplateAssetId = (id: string) => id.startsWith('tpl-')

/**
 * クラウドへ保存できるかの判定（サーバ・クライアント共通の単一の真実）。
 * 同じ id の置き換え（上書き）とテンプレ由来（tpl-）は枚数に数えない。
 */
export function hostedAssetVerdict(
  asset: Pick<UserGameAsset, 'id' | 'dataUrl'>,
  existingIds: Iterable<string>,
): HostedAssetVerdict {
  if (asset.dataUrl.length > HOSTED_ASSET_MAX_BYTES) return 'too_large'
  if (isTemplateAssetId(asset.id)) return 'ok'
  const ids = new Set([...existingIds].filter((id) => !isTemplateAssetId(id)))
  if (!ids.has(asset.id) && ids.size >= HOSTED_ASSET_LIMIT) return 'limit_reached'
  return 'ok'
}

// ---------------------------------------------------------------------------
// 持ち込みの無料枠（D-GAME-PRICE v2：持ち込み自体は有料・無料は枠つき）
// ---------------------------------------------------------------------------

/** 無料アカウントの持ち込み枚数（背景＋立ち絵の合算・テンプレ由来は数えない）。 */
export const FREE_IMPORT_LIMIT = 5

export type ImportVerdict = 'ok' | 'free_limit'

/**
 * 新しく画像を持ち込めるか。importedCount はテンプレ由来を除いた手元の枚数
 * （素材はこの端末に保存されるだけなので、判定もクライアントで行う）。
 */
export function importVerdict(importedCount: number, isMember: boolean): ImportVerdict {
  return !isMember && importedCount >= FREE_IMPORT_LIMIT ? 'free_limit' : 'ok'
}
