import { BOARD_LIMITS } from './types'

/**
 * 掲示板の表示名（記名式）を扱う純ロジック。React・DOM に依存しない。
 *
 * 掲示板は記名式（D-BOARD-SIGNED）で、名前がそのまま信用の単位になる。だから
 * 「見た目が同じで中身が違う名前」を 2 つ作れてはいけない。ここでは 2 段構えで守る。
 *
 * 1. normalizeDisplayName … 画面に出す形へ整える（見えない文字を落とし、空白をひとつに）。
 *    保存するのはこの形で、利用者が読める文字だけが残る。
 * 2. nameKeyOf … 重複判定・予約語判定に使う「畳んだ鍵」。大小・全半角・キリル文字の
 *    そっくりさん・長音や中黒といった隙間文字を落として、成りすましの手口を潰す。
 *    D1 の `board_profiles.name_key` に UNIQUE を張る前提なので、鍵は決定的に作る。
 *
 * 畳み込みは「弱く畳んで別人を通す」より「強く畳んで他人と衝突させる」側へ倒している。
 * 衝突しても利用者は名前を選び直すだけだが、成りすましは後から取り返せない。
 */

/** 制御文字・書式文字（ゼロ幅文字、双方向制御文字、ソフトハイフンなど）。 */
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/gu

/** 鍵を作るとき落とす「隙間」文字。空白・各種ダッシュ・長音符・中黒・アンダースコアなど。 */
const GAP_RE = /[\s_.·•‧・ー\-‐‑‒–—―−〜～~]/gu

/**
 * ラテン文字に化けられる文字の対応表（小文字化したあとの形で持つ）。
 * 目的は網羅ではなく、実際に成りすましへ使われる字を潰すこと。
 */
const CONFUSABLES: Record<string, string> = {
  // キリル文字
  а: 'a',
  в: 'b',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  ѕ: 's',
  һ: 'h',
  і: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  г: 'r',
  т: 't',
  у: 'y',
  ѡ: 'w',
  ԝ: 'w',
  х: 'x',
  ѐ: 'e',
  ё: 'e',
  // ギリシャ文字
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ν: 'v',
  η: 'n',
}

/** 改行・タブなど「空白として書かれた制御文字」。落とす前に空白へ置き換える。 */
const CONTROL_SPACE_RE = /[\t\n\v\f\r\u0085\u2028\u2029]/gu

/** 見えない文字を落として NFKC へ寄せる（正規化の共通前処理）。 */
function stripAndNormalize(raw: string): string {
  // 改行やタブは「単語の区切り」として書かれているので、消す前に空白へ倒す
  // （素朴に消すと "a\nb" が "ab" になり、別人の名前と衝突しうる）。
  // NFKC の前後どちらにも仕込めるので、見えない文字は 2 回落とす。
  return raw
    .replace(CONTROL_SPACE_RE, ' ')
    .replace(INVISIBLE_RE, '')
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
}

/**
 * 表示名を保存・表示する形へ整える。
 * NFKC 正規化、制御文字・ゼロ幅文字・双方向制御文字の除去、連続空白の 1 つへの圧縮、前後の除去。
 */
export function normalizeDisplayName(raw: string): string {
  return stripAndNormalize(raw).replace(/\s+/gu, ' ').trim()
}

/**
 * 重複判定・予約語判定に使う正規化キー。
 * NFKC ＋ 小文字化 ＋ そっくり文字の畳み込み ＋ 空白と隙間文字の除去。
 * 「見た目が同じになる別名」は必ず同じ鍵になる（＝あとから同名を取れない）。
 */
export function nameKeyOf(name: string): string {
  const base = stripAndNormalize(name).toLowerCase()
  let out = ''
  for (const ch of base) {
    out += CONFUSABLES[ch] ?? ch
  }
  return out.replace(GAP_RE, '')
}

/** 予約語の元の表記（鍵にする前）。運営・公式を騙れる語をここに集める。 */
const RESERVED_NAMES = [
  '運営',
  '運営チーム',
  '公式',
  '管理人',
  '管理者',
  'サポート',
  'コトノハ',
  'ことのは',
  'kotonoha',
  'leaf',
  'grove',
  'admin',
  'administrator',
  'moderator',
  'mod',
  'staff',
  'system',
  'support',
  'official',
  'root',
  'owner',
  'anonymous',
  '名無し',
]

/** 予約語を nameKeyOf に通した集合。判定は必ずこの鍵どうしで行う。 */
export const RESERVED_NAME_KEYS: ReadonlySet<string> = new Set(RESERVED_NAMES.map(nameKeyOf))

/** validateDisplayName が返す拒否理由。UI 側の文言はこの値で出し分ける。 */
export type DisplayNameError = 'empty' | 'too_long' | 'reserved' | 'invalid'

export type DisplayNameResult =
  | { ok: true; name: string; key: string }
  | { ok: false; reason: DisplayNameError }

/**
 * 表示名を検証して、保存する形（name）と重複判定の鍵（key）を返す。
 * 長さは正規化後の書記素ではなくコードポイントで数える（サロゲートペアで上限を抜けさせない）。
 */
export function validateDisplayName(raw: string): DisplayNameResult {
  const name = normalizeDisplayName(raw)
  if (name === '') return { ok: false, reason: 'empty' }
  if (Array.from(name).length > BOARD_LIMITS.displayName) return { ok: false, reason: 'too_long' }
  const key = nameKeyOf(name)
  // 記号や長音だけの名前は鍵が空になる＝重複判定ができないので受け付けない。
  if (key === '') return { ok: false, reason: 'invalid' }
  if (RESERVED_NAME_KEYS.has(key)) return { ok: false, reason: 'reserved' }
  return { ok: true, name, key }
}
