import { z } from 'zod'

/**
 * 正本（canonical）スキーマ。エディタライブラリ非依存・純TS。
 * これが保存・バックアップ・端末移行・各公開先変換の単一正本になる。
 */

export const InlineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('ruby'), base: z.string(), reading: z.string() }),
  z.object({ type: z.literal('emphasisDots'), text: z.string() }), // 傍点
  z.object({ type: z.literal('ref'), name: z.string() }), // @参照（P1）。name は辞書 entry の name/alias で解決
])
export type Inline = z.infer<typeof InlineSchema>

export const BlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('paragraph'), inlines: z.array(InlineSchema) }),
  z.object({ id: z.string(), type: z.literal('sceneBreak') }),
  // 将来: 'heading' | 'image'
])
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
})
export type Work = z.infer<typeof WorkSchema>
