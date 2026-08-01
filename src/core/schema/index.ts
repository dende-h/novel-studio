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
})
export type Work = z.infer<typeof WorkSchema>
