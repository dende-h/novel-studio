import type { Work } from '../schema'

/** 入力側の足切り：読み込んだ生テキスト（ファイル＋貼り付け）の合計バイト数。 */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
/**
 * 作成時の上限：`JSON.stringify(work)` の UTF-8 バイト数。
 * 保存形は行ごとにブロック化され生テキストの 2〜3 倍に膨らむ。同期は 1 作品 25MB を JSON 平文で
 * 判定し（functions/api/sync/work.ts）、クライアントに 413 の個別処理が無いので、ここで止める。
 */
export const MAX_WORK_JSON_BYTES = 20 * 1024 * 1024

export type TextEncodingName = 'utf-8' | 'shift_jis'

export interface DecodedText {
  text: string
  encoding: TextEncodingName
}

// タブ・改行（\t \n \r）以外の制御文字と置換文字。Shift_JIS デコーダはほぼ任意のバイト列を
// 黙って文字にするため、復号できたかではなく「文章らしいか」で判定する。
// 正規表現リテラルに制御文字を書くと lint（noControlCharactersInRegex）に掛かるので、コード点で判定する。
const isNotTextChar = (code: number) =>
  code === 0xfffd ||
  code <= 0x08 ||
  code === 0x0b ||
  code === 0x0c ||
  (code >= 0x0e && code <= 0x1f)

/** 復号結果が本文として読めるか（制御文字・置換文字を 1 つも含まない）。 */
export function looksLikeText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isNotTextChar(text.charCodeAt(i))) return false
  }
  return true
}

/** BOM を除き、CRLF / CR を LF に揃える。 */
export function normalizeImportedText(text: string): string {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return t.replace(/\r\n?/g, '\n')
}

/**
 * .txt のバイト列を UTF-8（fatal）→ Shift_JIS の順で復号する。
 * どちらの結果も `looksLikeText` を通らなければ null（画像のリネーム等）。復号後は normalize 済み。
 */
export function decodeTextFile(bytes: Uint8Array): DecodedText | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (looksLikeText(text)) return { text: normalizeImportedText(text), encoding: 'utf-8' }
    return null
  } catch {
    // UTF-8 として不正 → Shift_JIS を試す
  }
  try {
    const text = new TextDecoder('shift_jis').decode(bytes)
    if (looksLikeText(text)) return { text: normalizeImportedText(text), encoding: 'shift_jis' }
  } catch {
    // 実行環境が shift_jis ラベルを持たない（Node の small-icu 等）
  }
  return null
}

/** 文字列の UTF-8 バイト数（貼り付けの容量判定に使う）。 */
export function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** `JSON.stringify(work)` の UTF-8 バイト数。同期の平文サイズ判定と同じ尺度。 */
export function workJsonBytes(work: Work): number {
  return textBytes(JSON.stringify(work))
}
