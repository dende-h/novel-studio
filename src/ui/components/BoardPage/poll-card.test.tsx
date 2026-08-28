import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PollResult } from '@/core/board/types'
import { PollCard } from './poll-card'

const HOUR = 60 * 60 * 1000

/** 未投票・締切前（票数は伏せられている）。サーバの `pollResultFor` が返す形に合わせる。 */
const pollOf = (over: Partial<PollResult> = {}): PollResult => ({
  question: '次に作るならどれですか',
  options: ['縦書きの校正', 'スマホの編集', '共同編集'],
  multiple: false,
  closesAt: Date.now() + 3 * HOUR,
  closed: false,
  voted: false,
  myChoices: null,
  revealed: false,
  counts: null,
  total: null,
  ...over,
})

/** 票数入り（投票済み・または締切後）。 */
const revealedPoll = (over: Partial<PollResult> = {}): PollResult =>
  pollOf({
    voted: true,
    myChoices: [1],
    revealed: true,
    counts: [4, 6, 2],
    total: 10,
    ...over,
  })

const noop = async () => {}

describe('PollCard — 開示（D-BOARD-POLL）', () => {
  it('未投票かつ締切前は、票数も割合も一切描かない', () => {
    const { container } = render(<PollCard poll={pollOf()} onVote={noop} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\d+票/)
    expect(text).not.toMatch(/\d+%/)
    // 質問と選択肢は出す（投票させるために要る）
    expect(screen.getByText('次に作るならどれですか')).toBeInTheDocument()
    expect(screen.getByText('共同編集')).toBeInTheDocument()
  })

  it('未投票かつ締切前は、結果が隠れていることを伝える', () => {
    render(<PollCard poll={pollOf()} onVote={noop} />)
    expect(screen.getByText(/投票すると結果が見られます/)).toBeInTheDocument()
  })

  it('投票後は選択肢ごとの票数と割合を出す', () => {
    const { container } = render(<PollCard poll={revealedPoll()} onVote={noop} />)
    const text = container.textContent ?? ''
    expect(text).toContain('4票')
    expect(text).toContain('6票')
    expect(text).toContain('2票')
    // 分母は total（投票した人数）。counts の合計（12）ではない
    expect(text).toContain('40%')
    expect(text).toContain('60%')
    expect(text).toContain('20%')
  })

  it('締切後は未投票でも票数を出す', () => {
    const poll = pollOf({
      closesAt: Date.now() - HOUR,
      closed: true,
      revealed: true,
      counts: [1, 2, 0],
      total: 3,
    })
    const { container } = render(<PollCard poll={poll} onVote={noop} />)
    expect(container.textContent ?? '').toContain('1票')
  })

  it('割合の分母が投票した人数であることを注記する', () => {
    render(<PollCard poll={revealedPoll()} onVote={noop} />)
    expect(screen.getByText(/10人が投票しました/)).toBeInTheDocument()
  })

  it('複数選択のときは、票数の合計が人数と一致しないことを添える', () => {
    render(<PollCard poll={revealedPoll({ multiple: true, myChoices: [0, 1] })} onVote={noop} />)
    expect(screen.getByText(/票数の合計は人数と一致しません/)).toBeInTheDocument()
  })

  it('票が 1 つも無ければ 0 で割らず、その旨を出す', () => {
    const poll = revealedPoll({ counts: [0, 0, 0], total: 0, voted: false, myChoices: null })
    const { container } = render(<PollCard poll={poll} onVote={noop} />)
    expect(screen.getByText('まだ投票はありません')).toBeInTheDocument()
    expect(container.textContent ?? '').toContain('0%')
  })

  it('revealed でも counts が来なければ数字を作らない', () => {
    const poll = pollOf({ voted: true, revealed: true, counts: null, total: null })
    const { container } = render(<PollCard poll={poll} onVote={noop} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\d+票/)
    expect(text).not.toMatch(/\d+%/)
    expect(screen.getByText('共同編集')).toBeInTheDocument()
  })
})

describe('PollCard — 自分の選択', () => {
  it('自分が選んだ選択肢に印を付ける', () => {
    render(<PollCard poll={revealedPoll({ myChoices: [1] })} onVote={noop} />)
    expect(screen.getAllByText('あなたが選びました')).toHaveLength(1)
  })

  it('複数選んでいれば、その数だけ印が付く', () => {
    render(<PollCard poll={revealedPoll({ multiple: true, myChoices: [0, 2] })} onVote={noop} />)
    expect(screen.getAllByText('あなたが選びました')).toHaveLength(2)
  })

  it('未投票（締切後）は印を付けない', () => {
    const poll = revealedPoll({ closed: true, voted: false, myChoices: null })
    render(<PollCard poll={poll} onVote={noop} />)
    expect(screen.queryByText('あなたが選びました')).toBeNull()
  })
})

describe('PollCard — 締切', () => {
  it('締切前は残り時間を出す', () => {
    render(<PollCard poll={pollOf({ closesAt: Date.now() + 3 * HOUR + 60000 })} onVote={noop} />)
    expect(screen.getByText('あと3時間で締め切ります')).toBeInTheDocument()
  })

  it('締切後は投票欄を出さず、締め切ったことを出す', () => {
    const poll = revealedPoll({ closesAt: Date.now() - 2 * HOUR, closed: true, voted: false })
    const { container } = render(<PollCard poll={poll} onVote={noop} />)
    expect(screen.getByText(/締め切りました/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })

  it('投票済みなら締切前でも投票欄を出さない', () => {
    const { container } = render(<PollCard poll={revealedPoll()} onVote={noop} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })
})

describe('PollCard — 投票', () => {
  it('単一選択はラジオで、あとから選び直すと 1 つだけ残る', async () => {
    const onVote = vi.fn(async () => {})
    const { container } = render(<PollCard poll={pollOf()} onVote={onVote} />)
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    expect(inputs[0]?.type).toBe('radio')

    fireEvent.click(inputs[0] as HTMLInputElement)
    fireEvent.click(inputs[2] as HTMLInputElement)
    expect(inputs[0]?.checked).toBe(false)
    expect(inputs[2]?.checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '投票する' }))
    expect(onVote).toHaveBeenCalledWith([2])
  })

  it('複数選択はチェックボックスで、2 つ選んで送れる', () => {
    const onVote = vi.fn(async () => {})
    const { container } = render(<PollCard poll={pollOf({ multiple: true })} onVote={onVote} />)
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    expect(inputs[0]?.type).toBe('checkbox')

    fireEvent.click(inputs[2] as HTMLInputElement)
    fireEvent.click(inputs[0] as HTMLInputElement)
    expect(inputs[0]?.checked).toBe(true)
    expect(inputs[2]?.checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '投票する' }))
    // 昇順に正規化して送る（サーバの normalizeChoices と同じ形）
    expect(onVote).toHaveBeenCalledWith([0, 2])
  })

  it('何も選ばないうちは送れない', () => {
    const onVote = vi.fn(async () => {})
    render(<PollCard poll={pollOf()} onVote={onVote} />)
    const button = screen.getByRole('button', { name: '投票する' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onVote).not.toHaveBeenCalled()
  })

  it('送信中は二重送信しない', () => {
    // 解決しない Promise で「送信中」に留める
    const onVote = vi.fn(() => new Promise<void>(() => {}))
    const { container } = render(<PollCard poll={pollOf()} onVote={onVote} />)
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    fireEvent.click(inputs[0] as HTMLInputElement)

    fireEvent.click(screen.getByRole('button', { name: '投票する' }))
    const button = screen.getByRole('button', { name: '投票中…' })
    expect(button).toBeDisabled()
    fireEvent.click(button)

    expect(onVote).toHaveBeenCalledTimes(1)
  })

  it('送信が失敗しても送信中のまま固まらない', async () => {
    const onVote = vi.fn(async () => {
      throw new Error('network')
    })
    const { container } = render(<PollCard poll={pollOf()} onVote={onVote} />)
    fireEvent.click(container.querySelector('input') as HTMLInputElement)
    fireEvent.click(screen.getByRole('button', { name: '投票する' }))

    expect(await screen.findByRole('button', { name: '投票する' })).toBeEnabled()
  })

  it('disabled なら選べず、送れない', () => {
    const onVote = vi.fn(async () => {})
    const { container } = render(<PollCard poll={pollOf()} onVote={onVote} disabled />)
    expect(screen.getByRole('button', { name: '投票する' })).toBeDisabled()
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.disabled).toBe(true)
    fireEvent.click(input)
    fireEvent.click(screen.getByRole('button', { name: '投票する' }))
    expect(onVote).not.toHaveBeenCalled()
  })
})
