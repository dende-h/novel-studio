import { z } from 'zod'

/**
 * 正本（canonical）スキーマ。エディタライブラリ非依存・純TS。
 * これが保存・バックアップ・端末移行・各公開先変換の単一正本になる。
 */

const TextInlineSchema = z.object({ type: z.literal('text'), text: z.string() })
const RubyInlineSchema = z.object({
  type: z.literal('ruby'),
  base: z.string(),
  reading: z.string(),
})
const EmphasisDotsInlineSchema = z.object({ type: z.literal('emphasisDots'), text: z.string() }) // 傍点

/**
 * @参照の中に重ねられる装飾（`[[｜言葉《ことば》]]` / `[[《《言葉》》]]`）。
 * ref の入れ子は作らない＝重ねは 1 段だけ（再帰スキーマを持ち込まないための境界）。
 */
export const RefChildSchema = z.discriminatedUnion('type', [
  TextInlineSchema,
  RubyInlineSchema,
  EmphasisDotsInlineSchema,
])
export type RefChild = z.infer<typeof RefChildSchema>

export const InlineSchema = z.discriminatedUnion('type', [
  TextInlineSchema,
  RubyInlineSchema,
  EmphasisDotsInlineSchema,
  // @参照（P1）。name は辞書 entry の name/alias で解決する**プレーン文字列**。
  // children はルビ・傍点を重ねたときの表示内容（省略時は name をそのまま表示）。
  // name は常に children のプレーン文字列と一致させる（解決・文字数集計が name を見るため）。
  z.object({
    type: z.literal('ref'),
    name: z.string(),
    children: z.array(RefChildSchema).optional(),
  }),
])
export type Inline = z.infer<typeof InlineSchema>

const ParagraphBlockSchema = z.object({
  id: z.string(),
  type: z.literal('paragraph'),
  inlines: z.array(InlineSchema),
})

/**
 * 本文ブロック。現状は paragraph のみ（将来: 'heading' | 'image'）。
 * かつて存在した sceneBreak（＊行）は廃止。旧データ互換のため、読み込み時に
 * sceneBreak ブロックは空段落へ正規化する（破損扱いで弾かず、空行として残す）。
 */
export const BlockSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'sceneBreak') {
    return { id: (raw as { id?: string }).id ?? '', type: 'paragraph', inlines: [] }
  }
  return raw
}, ParagraphBlockSchema)
export type Block = z.infer<typeof BlockSchema>

export const EpisodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  blocks: z.array(BlockSchema),
})
export type Episode = z.infer<typeof EpisodeSchema>

/**
 * オブジェクト辞書の1項目（@参照の解決先）。P1。作品ごと（Work 相乗り）。
 * name + aliases が解決キー（trim 後の完全一致）。reading はサジェスト/ソート用で解決対象外。
 */
export const GlossaryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  category: z.string().optional(),
  reading: z.string().optional(),
  summary: z.string().optional(),
  body: z.string().optional(),
  // サムネイル画像（リサイズ済み JPEG の data URL）。P1.1。1枚・任意・旧データ互換。
  thumbnail: z
    .string()
    .refine((s) => s.startsWith('data:image/'), 'data URL が必要')
    .optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>

/**
 * 公開サイト（novel platform）のジャンル。先方が固定 6 種しか採らないので、こちらでも同じ 6 種だけ出す。
 * 6 種に収まらない言葉は自由タグ（tags）へ回す、という住み分け。
 */
export const PLATFORM_GENRES = [
  'ファンタジー',
  '恋愛',
  'ミステリー',
  'SF',
  '現代',
  'あやかし',
] as const

/** 公開サイトへ投稿するときの自由タグの上限（先方の受け入れ条件と同じ）。 */
export const PLATFORM_MAX_TAGS = 5
export const PLATFORM_MAX_TAG_LENGTH = 30

/**
 * あらすじ（`Work.description`）の長さ。
 *
 * 作品情報の編集と公開の管理は**同じ1つの項目**を書いているので、上限も1つにする
 * （かつて 250 と 2000 で食い違っていて、片方で書いた文がもう片方で足せなくなっていた）。
 * 公開サイトは 2000 字まで受けるが、あらすじは読者が最初に読む数行という位置づけなので、
 * 短いほう（EPUB の dc:description と同じ 250 字）に合わせる。
 */
export const MAX_DESCRIPTION_LENGTH = 250

/**
 * 公開サイト（novel platform）へ投稿するときだけ意味を持つ設定。
 * コトノハの本質は執筆なので、公開先固有の項目は Work 直下に散らさずここへまとめる。
 * すべて任意＝未投稿の作品・旧データはキーごと持たない。
 */
export const WorkPlatformSchema = z.object({
  // ジャンルは PLATFORM_GENRES のいずれかを入れる。型を enum に狭めないのは、先方が種類を
  // 増やしたときに保存済みデータが検証で落ちるのを避けるため（外れ値は先方が無視するだけ）。
  genre: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** 全年齢向けである、の誓約。規約同意なので既定値は持たせない（＝未誓約）。 */
  declaredAllAges: z.boolean().optional(),
  /** 一次創作である（無断転載でない）、の誓約。 */
  declaredOriginal: z.boolean().optional(),
  visibility: z.enum(['draft', 'public']).optional(),
  isCompleted: z.boolean().optional(),
  kind: z.enum(['serial', 'oneshot']).optional(),

  /**
   * 話ごとの公開状態（話ID → 公開状態）。記録の無い話は作品の公開状態に従う。
   *
   * 公開サイトへは `platform` の中ではなく **episodes[].visibility として送る**（契約 v3）。
   * こちらでまとめて持つのは、公開先固有の設定を Work 直下・Episode 直下へ散らさないため。
   */
  episodeVisibility: z.record(z.string(), z.enum(['draft', 'public'])).optional(),

  // ---- ここから下は公開サイトとの取り決めに無い＝コトノハのローカル専用。
  //      送信時に落とす（src/ui/_api/publish.ts の toBundleWork）。 ----
  /** 最後に投稿できた時刻。ライブラリで「投稿済みか」を判定して公開切替を出すのに使う。 */
  lastPublishedAt: z.number().optional(),
  /** 前回の投稿で返ってきた読者ページ／管理画面（公開サイトの絶対URL）。 */
  workUrl: z.string().optional(),
  manageUrl: z.string().optional(),
})
export type WorkPlatform = z.infer<typeof WorkPlatformSchema>

export const WorkSchema = z.object({
  id: z.string(),
  title: z.string(),
  episodes: z.array(EpisodeSchema),
  // 著者名・あらすじ（EPUB の dc:creator / dc:description に反映）。任意・旧データ互換。
  author: z.string().optional(),
  description: z.string().optional(),
  // 最終更新時刻（ライブラリの「最終編集」表示・EPUB の dcterms:modified 用）。旧データ互換のため任意。
  updatedAt: z.number().optional(),
  // オブジェクト辞書（@参照の解決先）。P1。旧データ互換のため任意。
  glossary: z.array(GlossaryEntrySchema).optional(),
  // 表紙画像（リサイズ済み JPEG の data URL）。P1.1。EPUB cover 用・1枚・任意・旧データ互換。
  coverImage: z
    .string()
    .refine((s) => s.startsWith('data:image/'), 'data URL が必要')
    .optional(),
  // 公開サイト（novel platform）への投稿設定。投稿しない作品は持たない・旧データ互換のため任意。
  platform: WorkPlatformSchema.optional(),
})
export type Work = z.infer<typeof WorkSchema>
