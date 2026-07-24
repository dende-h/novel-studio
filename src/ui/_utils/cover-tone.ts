/**
 * 表紙プレースホルダのトーン（デザインシステムの cream/wheat/forest 淡色）。
 * 表紙画像が無い作品カード・サイドバーの作品タイルの背景に使い、作品ごとに安定した色を割り当てる。
 */
export const COVER_TONES = ['#f2f7f1', '#f2e6d4', '#e3ece1', '#f9f7f5', '#f3ede4'] as const

/** seed（作品IDやタイトル）から決定的にトーンを選ぶ。 */
export function coverTone(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return COVER_TONES[h % COVER_TONES.length] as string
}
