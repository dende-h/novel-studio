import type { NovelRuleId } from './types'

/**
 * 原稿の作法ルール（行単位・プレーン文字列）。
 * tools/novel-textlint の general-novel-style-ja / novel-punctuation-ja / ja-no-successive-word を
 * 純 TS で書き直したもの。行頭の許可文字は .textlintrc.novel.json の chars_leading_paragraph と同じ。
 * 出現ごとに 1 件返し、位置（start・end）と「直せば行から消える文字列」（text）を持たせる（COT-40）。
 * 当たる行の集合は COT-30 と同じ。本文は書き換えない。
 */
export interface RuleHit {
  code: Exclude<NovelRuleId, 'variant' | 'doubled-particle' | 'ra-nuki'>
  message: string
  start: number
  end: number
  text: string
  anchor: 'contains' | 'lineStart'
}

/** 段落の頭に置いてよい文字（全角空白・開き括弧・記法の記号）。 */
export const LEADING_ALLOWED = '　「『【〈《（(“"‘\'［[〔｛{—…―–＊｜'

/** 日本語の文字（ひらがな・カタカナ・漢字・々・長音）。 */
const JA = '[ぁ-んァ-ヶ一-龯々ー]'
const HALF_EXCLAMATION = new RegExp(`${JA}[!?]|[!?]${JA}`, 'gu')
const HALF_PUNCT = new RegExp(`${JA}[,.]|[,.]${JA}`, 'gu')

/** ！？の直後が、空白・！？・三点リーダー・ダッシュ・閉じ括弧・行末のどれでもない（直後の 1 文字まで含めて取る）。 */
const EXCLAMATION_NO_SPACE = /[！？][^！？　 …―」』）〕】〉》]/gu

const PUNCT_BEFORE_CLOSE = /[。、][」』）]/gu
const NAKAGURO = /・{2,}/gu

/** 助詞 1 文字の重複。常用語（までで・なにに・ひとと・ちょっとと・とともに・ものの）は外す。 */
const DOUBLED_PARTICLE = /がが|をを|(?<!ま)でで|(?<!な)にに|(?<![ひっ])とと(?!もに)|(?<!も)のの/gu
/** 2〜6 文字の同じ文字列が隣り合う。漢字を含むかは TS 側で判定する（かなだけの畳語・擬音を外すため）。 */
const REPEATED_RUN = /([^\s、。！？「」『』（）…―・]{2,6})\1/gu
const HAS_KANJI = /[一-龯々]/u

export const MESSAGES = {
  indent: '段落の頭は全角空白を1つ空けるのが一般的です。会話文（「）はそのままで構いません。',
  'punct-before-close': '閉じ括弧の前の句読点（。、）は付けないのが一般的です。',
  'space-after-exclamation':
    '「！」「？」の後ろは全角空白を1つ空けるのが一般的です。閉じ括弧の前は要りません。',
  'leader-ellipsis': '三点リーダー（…）は2つ単位（……）で使うのが一般的です。',
  'leader-dash': 'ダッシュ（―）は2つ単位（――）で使うのが一般的です。',
  'leader-nakaguro': '中黒（・・・）ではなく三点リーダー（……）を使うのが一般的です。',
  'halfwidth-exclamation': '和文では感嘆符・疑問符は全角（！ ？）を使います。',
  'halfwidth-punct': '和文では句読点（、 。）を使います。',
} as const

/** 位置 i の直前の 1 文字（サロゲートペアなら 2 単位）の長さ。行頭なら 0。 */
function prevCharLen(text: string, i: number): number {
  if (i <= 0) return 0
  const low = text.charCodeAt(i - 1)
  return low >= 0xdc00 && low <= 0xdfff && i >= 2 ? 2 : 1
}

/** 位置 i から始まる 1 文字の長さ。行末なら 0。 */
function charLenAt(text: string, i: number): number {
  if (i >= text.length) return 0
  const high = text.charCodeAt(i)
  return high >= 0xd800 && high <= 0xdbff && i + 1 < text.length ? 2 : 1
}

function hit(
  code: RuleHit['code'],
  message: string,
  text: string,
  start: number,
  end: number,
  anchor: RuleHit['anchor'] = 'contains',
): RuleHit {
  return { code, message, start, end, text: text.slice(start, end), anchor }
}

/** 奇数の連なりを、前後 1 文字ずつを含めて返す（直したら連なりごと別の文字列になるように）。 */
function oddRuns(text: string, ch: string, message: string): RuleHit[] {
  const out: RuleHit[] = []
  for (const m of text.matchAll(new RegExp(`${ch}+`, 'gu'))) {
    if (m[0].length % 2 === 0) continue
    const s = m.index - prevCharLen(text, m.index)
    const runEnd = m.index + m[0].length
    out.push(hit('leader-odd', message, text, s, runEnd + charLenAt(text, runEnd)))
  }
  return out
}

function successiveWords(text: string): RuleHit[] {
  const out: RuleHit[] = []
  const message = (s: string) =>
    `同じ語が続いています（${s}）。打ち間違いでなければ、そのままで構いません。`
  for (const m of text.matchAll(DOUBLED_PARTICLE)) {
    out.push(hit('successive-word', message(m[0]), text, m.index, m.index + m[0].length))
  }
  for (const m of text.matchAll(REPEATED_RUN)) {
    if (!HAS_KANJI.test(m[1] ?? '')) continue
    const s = m.index
    const e = m.index + m[0].length
    if (out.some((h) => h.start < e && s < h.end)) continue
    out.push(hit('successive-word', message(m[0]), text, s, e))
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 1 行を検査する。空白だけの行は何も返さない。項目の順（字下げ→…→同じ語の連続）、項目の中は位置の順。 */
export function checkLine(text: string): RuleHit[] {
  if (!text.trim()) return []
  const hits: RuleHit[] = []
  if (!LEADING_ALLOWED.includes(text[0] ?? '')) {
    hits.push(hit('indent', MESSAGES.indent, text, 0, charLenAt(text, 0), 'lineStart'))
  }
  for (const m of text.matchAll(PUNCT_BEFORE_CLOSE)) {
    hits.push(hit('punct-before-close', MESSAGES['punct-before-close'], text, m.index, m.index + 2))
  }
  for (const m of text.matchAll(EXCLAMATION_NO_SPACE)) {
    const msg = MESSAGES['space-after-exclamation']
    hits.push(hit('space-after-exclamation', msg, text, m.index, m.index + m[0].length))
  }
  const leaders = [
    ...oddRuns(text, '…', MESSAGES['leader-ellipsis']),
    ...oddRuns(text, '―', MESSAGES['leader-dash']),
    ...[...text.matchAll(NAKAGURO)].map((m) =>
      hit('leader-odd', MESSAGES['leader-nakaguro'], text, m.index, m.index + m[0].length),
    ),
  ]
  hits.push(...leaders.sort((a, b) => a.start - b.start))
  const halves = [
    ...[...text.matchAll(HALF_EXCLAMATION)].map((m) =>
      hit(
        'halfwidth-punct',
        MESSAGES['halfwidth-exclamation'],
        text,
        m.index,
        m.index + m[0].length,
      ),
    ),
    ...[...text.matchAll(HALF_PUNCT)].map((m) =>
      hit('halfwidth-punct', MESSAGES['halfwidth-punct'], text, m.index, m.index + m[0].length),
    ),
  ]
  hits.push(...halves.sort((a, b) => a.start - b.start))
  hits.push(...successiveWords(text))
  return hits
}
