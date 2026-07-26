/**
 * 執筆量の節目でだけ出す「バックアップの案内」の判定（タスク4）。純ロジック＝UI から独立してテストする。
 *
 * 思想：これは販売導線ではなく UX の穴ふさぎ。「原稿はクラウドにあるはず」という思い込みのまま
 * 端末が壊れて初めて気づく——その事故を、事故の前に減らすための静かな声かけ。だから
 * - 常設のカードやバナーにはしない（＝ノイズ）。節目を跨いだ“そのとき”にだけ、モーダルで一度。
 * - 無料の人にだけ（会員はクラウドバックアップ済み）。
 * - 最近ちゃんとバックアップしてある人には出さない（安全なら黙る）。
 * - 解散したら 30 日は黙る（クールダウン）。
 *
 * 「トリガー検知（節目を跨いだか）」と「表示タイミング（今出してよいか）」を分けて扱う。
 */

/** 累計文字数の節目の刻み（この字数ごとに一度）。 */
export const NUDGE_CHARS_STEP = 30_000
/** 執筆した日数の節目の刻み（この日数ごとに一度）。 */
export const NUDGE_DAYS_STEP = 14
/** 解散（バックアップ実行・×・外側クリック）後、この期間は再表示しない。 */
export const NUDGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000
/** 前回バックアップからの書き足しがこの文字数未満なら「最近取った＝安全」とみなし出さない。 */
export const NUDGE_SAFE_DELTA = 3_000

/** localStorage に持つ「どこまで案内済みか」。 */
export interface NudgeAck {
  /** 承認済みの文字数レベル（= floor(累計字数 / STEP)）。 */
  charLevel: number
  /** 承認済みの日数レベル（= floor(執筆日数 / STEP)）。 */
  dayLevel: number
  /** 最後に解散した時刻（epoch ms・未解散は 0）。 */
  dismissedAt: number
}

/** バックアップの実行状況（use-backup-marks の値）。 */
export interface NudgeMarks {
  localBackupAt: number | null
  localBackupChars: number | null
  cloudBackupAt: number | null
}

export interface DecideNudgeInput {
  /** 全作品の総文字数。 */
  totalChars: number
  /** これまでに執筆した日数（summarize().activeDays）。 */
  activeDays: number
  marks: NudgeMarks
  ack: NudgeAck
  now: number
}

/** 文面の状態：一度も取っていない／前回から ◯字書き足した。 */
export type NudgeBody = { kind: 'never' } | { kind: 'delta'; chars: number }

export type NudgeDecision =
  | { show: false }
  | {
      show: true
      /** 見出し（達成をたたえる一言）。 */
      headline: string
      body: NudgeBody
      /** 解散時に承認へ書き戻す現在レベル。 */
      charLevel: number
      dayLevel: number
    }

const K1 = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1..9999 の整数を漢数字に（十百千・位取り省略あり）。範囲外は算用数字にフォールバック。 */
export function kanjiInt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return String(n)
  if (n > 9999) return n.toLocaleString('ja-JP')
  let s = ''
  const sen = Math.floor(n / 1000)
  const hyaku = Math.floor((n % 1000) / 100)
  const juu = Math.floor((n % 100) / 10)
  const ichi = n % 10
  if (sen) s += `${sen === 1 ? '' : K1[sen]}千`
  if (hyaku) s += `${hyaku === 1 ? '' : K1[hyaku]}百`
  if (juu) s += `${juu === 1 ? '' : K1[juu]}十`
  if (ichi) s += K1[ichi]
  return s
}

/** 万単位の数を「◯万」の漢数字に（3 → 三万）。 */
export function kanjiMan(man: number): string {
  return `${kanjiInt(man)}万`
}

/**
 * 案内を出すか／出すなら文面はどれかを決める。副作用なし。
 * 承認レベルの更新は呼び出し側が解散時に行う（ここでは現在レベルを返すだけ）。
 */
export function decideBackupNudge(input: DecideNudgeInput): NudgeDecision {
  const charLevel = Math.floor(input.totalChars / NUDGE_CHARS_STEP)
  const dayLevel = Math.floor(input.activeDays / NUDGE_DAYS_STEP)

  // トリガー検知：前回承認した節目より先へ進んだか（字数 OR 日数）。
  const crossedChars = charLevel > input.ack.charLevel
  const crossedDays = dayLevel > input.ack.dayLevel
  if (!crossedChars && !crossedDays) return { show: false }

  // 表示タイミング：解散から 30 日のクールダウン中は黙る。
  if (input.now - input.ack.dismissedAt < NUDGE_COOLDOWN_MS) return { show: false }

  // バックアップ状況で文面を決める（最近取ってあれば出さない）。
  const hasBackup = input.marks.localBackupAt != null || input.marks.cloudBackupAt != null
  const delta = Math.max(0, input.totalChars - (input.marks.localBackupChars ?? 0))
  let body: NudgeBody
  if (!hasBackup) {
    body = { kind: 'never' }
  } else if (delta < NUDGE_SAFE_DELTA) {
    return { show: false } // 最近バックアップ済み＝安全なので出さない
  } else {
    body = { kind: 'delta', chars: delta }
  }

  // 見出し：字数の節目を優先してたたえる（両方跨いだら字数側）。
  const headline = crossedChars
    ? `${kanjiMan(charLevel * (NUDGE_CHARS_STEP / 10_000))}字を越えました！`
    : `書いた日が${kanjiInt(dayLevel * NUDGE_DAYS_STEP)}日になりました。`

  return { show: true, headline, body, charLevel, dayLevel }
}
