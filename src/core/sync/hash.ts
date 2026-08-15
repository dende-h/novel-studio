import { type Work, WorkSchema } from '../schema'

/**
 * 同期のハッシュ基盤。push する body とハッシュ対象を**同一文字列**に固定するのが要点。
 * WorkSchema.parse がキー順をスキーマ定義順に正規化し未知キーを落とすので、
 * その JSON.stringify を canonical 形とする（端末が違っても同内容なら同ハッシュ）。
 */

/** Work の canonical JSON。push body・ハッシュ対象はこの文字列に統一する。 */
export function canonicalWorkJson(work: Work): string {
  return JSON.stringify(WorkSchema.parse(work))
}

/**
 * SHA-256 の hex。canonicalize 済み文字列に対して使う（ハッシュ一致判定）。
 * functions/api/_lib/crypto.ts と同じ実装（functions は import できないのでコピー）。
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
