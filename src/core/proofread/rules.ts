import type { NovelRuleId } from './types'

/**
 * 原稿の作法ルール（行単位・プレーン文字列）。
 * tools/novel-textlint の general-novel-style-ja / novel-punctuation-ja / ja-no-successive-word を
 * 純 TS で書き直したもの。行頭の許可文字は .textlintrc.novel.json の chars_leading_paragraph と同じ。
 * 同じ code は 1 行に 1 件まで。本文は書き換えない。
 */
export interface RuleHit {
  code: Exclude<NovelRuleId, 'variant'>
  message: string
}

/** 段落の頭に置いてよい文字（全角空白・開き括弧・記法の記号）。 */
export const LEADING_ALLOWED = '　「『【〈《（(“"‘\'［[〔｛{—…―–＊｜'

/** 日本語の文字（ひらがな・カタカナ・漢字・々・長音）。 */
const JA = '[ぁ-んァ-ヶ一-龯々ー]'
const HALF_EXCLAMATION = new RegExp(`${JA}[!?]|[!?]${JA}`, 'u')
const HALF_PUNCT = new RegExp(`${JA}[,.]|[,.]${JA}`, 'u')

/** ！？の直後が、空白・！？・三点リーダー・ダッシュ・閉じ括弧・行末のどれでもない。 */
const EXCLAMATION_NO_SPACE = /[！？](?=[^！？　 …―」』）〕】〉》])/u

/** 助詞 1 文字の重複。常用語（までで・なにに・ひとと・ちょっとと・とともに・ものの）は外す。 */
const DOUBLED_PARTICLE = /がが|をを|(?<!ま)でで|(?<!な)にに|(?<![ひっ])とと(?!もに)|(?<!も)のの/u
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

function hasOddRun(text: string, ch: string): boolean {
  const re = new RegExp(`${ch}+`, 'gu')
  for (const m of text.matchAll(re)) if (m[0].length % 2 === 1) return true
  return false
}

function successiveWord(text: string): string | null {
  const particle = DOUBLED_PARTICLE.exec(text)?.[0]
  if (particle) return particle
  for (const m of text.matchAll(REPEATED_RUN)) {
    if (HAS_KANJI.test(m[1] ?? '')) return m[0]
  }
  return null
}

/** 1 行を検査する。空白だけの行は何も返さない。 */
export function checkLine(text: string): RuleHit[] {
  if (!text.trim()) return []
  const hits: RuleHit[] = []
  if (!LEADING_ALLOWED.includes(text[0] ?? ''))
    hits.push({ code: 'indent', message: MESSAGES.indent })
  if (/[。、][」』）]/u.test(text)) {
    hits.push({ code: 'punct-before-close', message: MESSAGES['punct-before-close'] })
  }
  if (EXCLAMATION_NO_SPACE.test(text)) {
    hits.push({ code: 'space-after-exclamation', message: MESSAGES['space-after-exclamation'] })
  }
  if (hasOddRun(text, '…')) hits.push({ code: 'leader-odd', message: MESSAGES['leader-ellipsis'] })
  else if (hasOddRun(text, '―')) hits.push({ code: 'leader-odd', message: MESSAGES['leader-dash'] })
  else if (/・{2,}/u.test(text)) {
    hits.push({ code: 'leader-odd', message: MESSAGES['leader-nakaguro'] })
  }
  if (HALF_EXCLAMATION.test(text)) {
    hits.push({ code: 'halfwidth-punct', message: MESSAGES['halfwidth-exclamation'] })
  } else if (HALF_PUNCT.test(text)) {
    hits.push({ code: 'halfwidth-punct', message: MESSAGES['halfwidth-punct'] })
  }
  const repeated = successiveWord(text)
  if (repeated) {
    hits.push({
      code: 'successive-word',
      message: `同じ語が続いています（${repeated}）。打ち間違いでなければ、そのままで構いません。`,
    })
  }
  return hits
}
