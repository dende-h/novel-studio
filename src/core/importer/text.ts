import type { Work } from '../schema'

/** 入力側の足切り：読み込んだ生テキスト（ファイル＋貼り付け）の合計バイト数。 */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
/**
 * 作成時の上限：`JSON.stringify(work)` の UTF-8 バイト数。
 * 保存形は行ごとにブロック化され生テキストの 2〜3 倍に膨らむ。同期は 1 作品 25MB を JSON 平文で
 * 判定し（functions/api/sync/work.ts）、クライアントに 413 の個別処理が無いので、ここで止める。
 */
export const MAX_WORK_JSON_BYTES = 20 * 1024 * 1024

export type TextEncodingName = 'utf-8' | 'shift_jis' | 'euc-jp' | 'iso-2022-jp'

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
  (code >= 0x0e && code <= 0x1f) ||
  (code >= 0x7f && code <= 0x9f)

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

function decodeAs(bytes: Uint8Array, encoding: TextEncodingName): DecodedText | null {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    return looksLikeText(text) ? { text: normalizeImportedText(text), encoding } : null
  } catch {
    return null
  }
}

export function decodeTextFile(
  bytes: Uint8Array,
  preferred?: TextEncodingName,
): DecodedText | null {
  if (preferred) return decodeAs(bytes, preferred)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decodeAs(bytes, 'utf-8')
  if (bytes.includes(27)) return decodeAs(bytes, 'iso-2022-jp')
  const utf8 = decodeAs(bytes, 'utf-8')
  if (utf8) return utf8
  // EUC-JP and CP932 overlap. Prefer the decode with fewer half-width kana when both are legal.
  const sjis = decodeAs(bytes, 'shift_jis')
  const euc = decodeAs(bytes, 'euc-jp')
  if (sjis && euc) {
    const score = (text: string) => text.match(/[｡-ﾟ]/g)?.length ?? 0
    return score(euc.text) < score(sjis.text) ? euc : sjis
  }
  return sjis ?? euc
}

export function readManuscriptText(bytes: Uint8Array): string {
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('TXTは20 MBまで取り込めます')
  const signature = new TextDecoder().decode(bytes.subarray(0, 32))
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  if (zip || /^%PDF-|^GIF8[79]a|^RIFF....WEBP|^<\?xml\b|^<!doctype html\b/i.test(signature)) {
    throw new Error('中身がTXT形式と一致しません')
  }
  const decoded = decodeTextFile(bytes)
  if (!decoded)
    throw new Error('文字を読み込めません。UTF-8、Shift_JIS、EUC-JP、JISのTXTを選んでください')
  if (!decoded.text.trim()) throw new Error('本文が空です')
  return decoded.text
}

/** 文字列の UTF-8 バイト数（貼り付けの容量判定に使う）。 */
export function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** `JSON.stringify(work)` の UTF-8 バイト数。同期の平文サイズ判定と同じ尺度。 */
export function workJsonBytes(work: Work): number {
  return textBytes(JSON.stringify(work))
}
