import type { PollLike, VoteLike } from './poll'
import {
  canVote,
  isPollClosed,
  isPollOpen,
  normalizeChoices,
  pollResultFor,
  tallyVotes,
  validatePollInput,
} from './poll'
import { BOARD_LIMITS } from './types'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

function poll(over: Partial<PollLike> = {}): PollLike {
  return {
    question: '次に作る機能はどれ？',
    options: ['縦書き', '音声入力', '差分表示'],
    multiple: false,
    closesAt: NOW + HOUR,
    ...over,
  }
}

function votes(...choices: number[][]): VoteLike[] {
  return choices.map((c) => ({ choices: c }))
}

describe('validatePollInput', () => {
  const base = { question: 'どれ？', options: ['あ', 'い'], closesAt: NOW + HOUR }

  it('質問と選択肢 2 つ・未来の締切なら通る', () => {
    expect(validatePollInput(base, NOW)).toEqual({ ok: true })
  })

  it('質問が空白だけなら弾く', () => {
    expect(validatePollInput({ ...base, question: '　 ' }, NOW)).toEqual({
      ok: false,
      reason: 'question_empty',
    })
  })

  it('選択肢が 1 つなら弾く', () => {
    expect(validatePollInput({ ...base, options: ['あ'] }, NOW)).toEqual({
      ok: false,
      reason: 'too_few_options',
    })
  })

  it('選択肢が上限ちょうどなら通り、1 つ超えたら弾く', () => {
    const max = Array.from({ length: BOARD_LIMITS.pollOptionCount }, (_, i) => `選択肢${i}`)
    expect(validatePollInput({ ...base, options: max }, NOW)).toEqual({ ok: true })
    expect(validatePollInput({ ...base, options: [...max, '余分'] }, NOW)).toEqual({
      ok: false,
      reason: 'too_many_options',
    })
  })

  it('空の選択肢は弾く', () => {
    expect(validatePollInput({ ...base, options: ['あ', '  '] }, NOW)).toEqual({
      ok: false,
      reason: 'option_empty',
    })
  })

  it('重複した選択肢は弾く（前後の空白は無視して比較する）', () => {
    expect(validatePollInput({ ...base, options: ['あ', ' あ '] }, NOW)).toEqual({
      ok: false,
      reason: 'duplicate_option',
    })
  })

  it('締切が過去・現在なら弾く', () => {
    expect(validatePollInput({ ...base, closesAt: NOW - 1 }, NOW)).toEqual({
      ok: false,
      reason: 'closes_at_past',
    })
    expect(validatePollInput({ ...base, closesAt: NOW }, NOW)).toEqual({
      ok: false,
      reason: 'closes_at_past',
    })
  })

  it('締切が数値でなければ弾く（必須）', () => {
    expect(validatePollInput({ ...base, closesAt: Number.NaN }, NOW)).toEqual({
      ok: false,
      reason: 'closes_at_required',
    })
  })
})

describe('isPollOpen / isPollClosed', () => {
  it('締切ちょうどは締切後として扱う', () => {
    const p = poll({ closesAt: NOW })
    expect(isPollOpen(p, NOW)).toBe(false)
    expect(isPollClosed(p, NOW)).toBe(true)
    expect(isPollOpen(p, NOW - 1)).toBe(true)
  })
})

describe('tallyVotes', () => {
  it('選択肢ごとに数え、total は投票した人数', () => {
    expect(tallyVotes(votes([0], [0], [2]), 3)).toEqual({ counts: [2, 0, 1], total: 3 })
  })

  it('複数選択では counts の合計が total を超える', () => {
    const t = tallyVotes(votes([0, 1], [1, 2]), 3)
    expect(t).toEqual({ counts: [1, 2, 1], total: 2 })
  })

  it('範囲外の index は無視し、その票だけが空なら人数に数えない', () => {
    expect(tallyVotes(votes([5], [-1], [1]), 3)).toEqual({ counts: [0, 1, 0], total: 1 })
  })

  it('1 票の中の重複は 1 回だけ数える', () => {
    expect(tallyVotes(votes([1, 1, 1]), 3)).toEqual({ counts: [0, 1, 0], total: 1 })
  })

  it('票が無ければ 0 埋めの配列を返す', () => {
    expect(tallyVotes([], 3)).toEqual({ counts: [0, 0, 0], total: 0 })
  })
})

describe('pollResultFor — 開示規則（D-BOARD-POLL）', () => {
  const cast = votes([0], [0], [1])

  it('未投票かつ締切前は票数を返さない', () => {
    const r = pollResultFor(poll(), cast, null, NOW)
    expect(r.revealed).toBe(false)
    expect(r.voted).toBe(false)
    expect(r.closed).toBe(false)
    expect(r.counts).toBeNull()
    expect(r.total).toBeNull()
    expect(r.myChoices).toBeNull()
  })

  it('質問と選択肢は未投票でも返す（投票させるために要る）', () => {
    const r = pollResultFor(poll(), cast, null, NOW)
    expect(r.question).toBe('次に作る機能はどれ？')
    expect(r.options).toEqual(['縦書き', '音声入力', '差分表示'])
  })

  it('投票した瞬間から票数が返る', () => {
    const mine: VoteLike = { choices: [1] }
    const r = pollResultFor(poll(), [...cast, mine], mine, NOW)
    expect(r.revealed).toBe(true)
    expect(r.voted).toBe(true)
    expect(r.counts).toEqual([2, 2, 0])
    expect(r.total).toBe(4)
    expect(r.myChoices).toEqual([1])
  })

  it('締切後は未投票でも票数が返る', () => {
    const r = pollResultFor(poll(), cast, null, NOW + HOUR)
    expect(r.closed).toBe(true)
    expect(r.voted).toBe(false)
    expect(r.revealed).toBe(true)
    expect(r.counts).toEqual([2, 1, 0])
    expect(r.total).toBe(3)
  })
})

describe('canVote', () => {
  it('締切前で未投票なら投票できる', () => {
    expect(canVote(poll(), null, NOW)).toEqual({ ok: true })
  })

  it('締切後の投票は拒否する', () => {
    expect(canVote(poll(), null, NOW + HOUR)).toEqual({ ok: false, reason: 'closed' })
  })

  it('2 回目の投票は拒否する（1 アカウント 1 票・上書きしない）', () => {
    expect(canVote(poll(), { choices: [0] }, NOW)).toEqual({ ok: false, reason: 'already_voted' })
  })

  it('締切後かつ投票済みなら締切を理由にする', () => {
    expect(canVote(poll(), { choices: [0] }, NOW + HOUR)).toEqual({ ok: false, reason: 'closed' })
  })
})

describe('normalizeChoices', () => {
  it('単一選択は 1 つだけ受け付ける', () => {
    expect(normalizeChoices([2], poll())).toEqual({ ok: true, choices: [2] })
    expect(normalizeChoices([0, 1], poll())).toEqual({ ok: false, reason: 'too_many' })
  })

  it('複数選択は 1 つ以上を昇順で返す', () => {
    expect(normalizeChoices([2, 0], poll({ multiple: true }))).toEqual({
      ok: true,
      choices: [0, 2],
    })
  })

  it('空の選択は弾く', () => {
    expect(normalizeChoices([], poll({ multiple: true }))).toEqual({ ok: false, reason: 'empty' })
  })

  it('範囲外の index を弾く', () => {
    expect(normalizeChoices([3], poll())).toEqual({ ok: false, reason: 'out_of_range' })
    expect(normalizeChoices([-1], poll())).toEqual({ ok: false, reason: 'out_of_range' })
    expect(normalizeChoices([1.5], poll())).toEqual({ ok: false, reason: 'out_of_range' })
  })

  it('重複した index を弾く', () => {
    expect(normalizeChoices([1, 1], poll({ multiple: true }))).toEqual({
      ok: false,
      reason: 'duplicate',
    })
  })

  it('選択肢の数を超える個数は弾く', () => {
    expect(normalizeChoices([0, 1, 2, 0], poll({ multiple: true }))).toEqual({
      ok: false,
      reason: 'too_many',
    })
  })
})
