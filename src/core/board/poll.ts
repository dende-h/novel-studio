/**
 * 掲示板アンケート（D-BOARD-POLL）の検証・集計・**開示判定**を集めた純ロジック。
 *
 * 要は「投票するまで結果を見せない」という 1 つの規則を守り切るためのファイル。
 * 先に票数が見えると後から投票する人が引っ張られるので、開示の分岐が UI と API の
 * 2 箇所に散ると片方だけ緩んで規則が壊れる。そこで **開示してよいかの判断を
 * pollResultFor 1 本に閉じ込め**、票数を返さない場合は counts / total に値を入れず
 * `null` を返す（0 埋めにすると「0 票」と誤読でき、票数を漏らしたのと変わらない）。
 *
 * 締切の判定に `Date.now()` を呼ばず必ず `now` を引数で受けるのも同じ理由で、
 * サーバの保存時刻とクライアントの表示時刻を同じ関数でテストできるようにしている。
 */

import type { PollResult } from './types'
import { BOARD_LIMITS } from './types'

// ---------------------------------------------------------------------------
// 受け取る形（BoardPoll / BoardVote の必要な部分だけを構造的に受ける）
// ---------------------------------------------------------------------------

/** 集計・判定に要るぶんだけのアンケート。Zod の `BoardPoll` はこれを満たす。 */
export type PollLike = {
  /** 質問文 */
  question: string
  /** 選択肢（表示順） */
  options: readonly string[]
  /** 複数選択を許すか */
  multiple: boolean
  /** 締切（epoch ms・これを含む以降は締切後） */
  closesAt: number
}

/** 1 票。`choices` は選択肢の index。 */
export type VoteLike = {
  choices: readonly number[]
}

/**
 * アンケート作成の入力のうち、この検証で見るぶんだけ。
 * types.ts の `PollInput` はこれを満たす（構造的に受けることで、Zod で既定値の付いた
 * `multiple` を書かなくてもテストから呼べる）。
 */
export type PollInputLike = {
  question: string
  options: readonly string[]
  /** 締切（epoch ms）。必須。 */
  closesAt: number
}

/** 検証の失敗理由。UI の文言はこのキーで引く。 */
export type PollInputError =
  | 'question_empty'
  | 'too_few_options'
  | 'too_many_options'
  | 'option_empty'
  | 'duplicate_option'
  | 'closes_at_required'
  | 'closes_at_past'

export type PollInputResult = { ok: true } | { ok: false; reason: PollInputError }

/** 投票可否の失敗理由。 */
export type VoteDeniedReason = 'closed' | 'already_voted'

export type CanVoteResult = { ok: true } | { ok: false; reason: VoteDeniedReason }

/** 選択 index の検証の失敗理由。 */
export type ChoicesError = 'empty' | 'out_of_range' | 'duplicate' | 'too_many'

export type NormalizeChoicesResult =
  | { ok: true; choices: number[] }
  | { ok: false; reason: ChoicesError }

/** 集計結果。`total` は「1 票以上を投じた人数」で、counts の合計ではない（複数選択があるため）。 */
export type Tally = { counts: number[]; total: number }

// ---------------------------------------------------------------------------
// 入力の検証
// ---------------------------------------------------------------------------

/**
 * アンケート作成の入力を検証する。
 * 選択肢は 2〜`BOARD_LIMITS.pollOptionCount`、空・重複は不可、締切は必須で未来。
 * 重複は前後の空白を落として比較する（見た目が同じ選択肢が並ぶと票が割れて集計が壊れる）。
 */
export function validatePollInput(input: PollInputLike, now: number): PollInputResult {
  if (input.question.trim() === '') return { ok: false, reason: 'question_empty' }

  const options = input.options
  if (options.length < 2) return { ok: false, reason: 'too_few_options' }
  if (options.length > BOARD_LIMITS.pollOptionCount)
    return { ok: false, reason: 'too_many_options' }

  const seen = new Set<string>()
  for (const raw of options) {
    const label = raw.trim()
    if (label === '') return { ok: false, reason: 'option_empty' }
    if (seen.has(label)) return { ok: false, reason: 'duplicate_option' }
    seen.add(label)
  }

  if (!Number.isFinite(input.closesAt)) return { ok: false, reason: 'closes_at_required' }
  if (input.closesAt <= now) return { ok: false, reason: 'closes_at_past' }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// 締切
// ---------------------------------------------------------------------------

/** 締切前なら true（`now === closesAt` は締切後扱い）。 */
export function isPollOpen(poll: PollLike, now: number): boolean {
  return now < poll.closesAt
}

/** 締切後なら true。 */
export function isPollClosed(poll: PollLike, now: number): boolean {
  return !isPollOpen(poll, now)
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

/**
 * 票を数える。範囲外の index は無視し、1 票の中の重複は 1 回だけ数える
 * （壊れた行が 1 つあっても集計全体を落とさないため、例外は投げない）。
 * `total` は 1 つ以上の有効な選択を含む票の数＝投票した人数。
 */
export function tallyVotes(votes: readonly VoteLike[], optionCount: number): Tally {
  const size = Math.max(0, Math.trunc(optionCount))
  const counts = new Array<number>(size).fill(0)
  let total = 0

  for (const vote of votes) {
    let counted = false
    const seen = new Set<number>()
    for (const choice of vote.choices) {
      if (!Number.isInteger(choice)) continue
      if (choice < 0 || choice >= size) continue
      if (seen.has(choice)) continue
      seen.add(choice)
      counts[choice] = (counts[choice] ?? 0) + 1
      counted = true
    }
    if (counted) total++
  }

  return { counts, total }
}

// ---------------------------------------------------------------------------
// 開示 — D-BOARD-POLL の本体
// ---------------------------------------------------------------------------

/**
 * 表示用のアンケート結果を組み立てる。**開示規則はここだけにある。**
 * 未投票 かつ 締切前 → 票数を返さない（counts / total は null）。
 * 投票済み、または締切後 → 票数を返す。
 */
export function pollResultFor(
  poll: PollLike,
  votes: readonly VoteLike[],
  myVote: VoteLike | null | undefined,
  now: number,
): PollResult {
  const closed = isPollClosed(poll, now)
  const voted = myVote != null
  const revealed = voted || closed
  const tally = revealed ? tallyVotes(votes, poll.options.length) : null

  return {
    question: poll.question,
    options: [...poll.options],
    multiple: poll.multiple,
    closesAt: poll.closesAt,
    closed,
    voted,
    myChoices: myVote ? [...myVote.choices] : null,
    revealed,
    counts: tally ? tally.counts : null,
    total: tally ? tally.total : null,
  }
}

// ---------------------------------------------------------------------------
// 投票
// ---------------------------------------------------------------------------

/**
 * 投票してよいか。締切後は不可、既に投票済みも不可
 * （1 アカウント 1 票・**上書きしない**。上書きを許すと開示後に票を動かせる）。
 */
export function canVote(
  poll: PollLike,
  myVote: VoteLike | null | undefined,
  now: number,
): CanVoteResult {
  if (isPollClosed(poll, now)) return { ok: false, reason: 'closed' }
  if (myVote != null) return { ok: false, reason: 'already_voted' }
  return { ok: true }
}

/**
 * 送られてきた選択 index を検証して正規化する。
 * 範囲外・重複・整数でないものを弾き、単一選択なら 1 つだけ、複数選択なら 1 つ以上を要求する。
 * 通ったものは昇順に並べ替えて返す（保存の形を 1 つに決めておくと突き合わせが楽）。
 */
export function normalizeChoices(raw: readonly number[], poll: PollLike): NormalizeChoicesResult {
  if (raw.length === 0) return { ok: false, reason: 'empty' }
  if (!poll.multiple && raw.length > 1) return { ok: false, reason: 'too_many' }
  if (raw.length > poll.options.length) return { ok: false, reason: 'too_many' }

  const seen = new Set<number>()
  for (const choice of raw) {
    if (!Number.isInteger(choice)) return { ok: false, reason: 'out_of_range' }
    if (choice < 0 || choice >= poll.options.length) return { ok: false, reason: 'out_of_range' }
    if (seen.has(choice)) return { ok: false, reason: 'duplicate' }
    seen.add(choice)
  }

  return { ok: true, choices: [...seen].sort((a, b) => a - b) }
}
