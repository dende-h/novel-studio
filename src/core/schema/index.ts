import { z } from 'zod'

/**
 * 正本（canonical）スキーマ。エディタライブラリ非依存・純TS。
 * これが保存・バックアップ・端末移行・各公開先変換の単一正本になる。
 */

export const InlineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('ruby'), base: z.string(), reading: z.string() }),
  z.object({ type: z.literal('emphasisDots'), text: z.string() }), // 傍点
  // 将来: { type: 'ref'; name: string }  // @参照（P1）
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

export const WorkSchema = z.object({
  id: z.string(),
  title: z.string(),
  episodes: z.array(EpisodeSchema),
})
export type Work = z.infer<typeof WorkSchema>
