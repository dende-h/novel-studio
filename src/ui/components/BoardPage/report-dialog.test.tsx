import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BOARD_LIMITS, type ReportInput } from '@/core/board/types'
import type { BoardResult } from '@/ui/_api/board'
import { REPORT_PRESETS, ReportDialog } from './report-dialog'

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

const okSubmit = () => vi.fn(async (): Promise<BoardResult<null>> => ({ ok: true, data: null }))

const failSubmit = (code: string, message: string, status: number) =>
  vi.fn(async (): Promise<BoardResult<null>> => ({ ok: false, code, message, status }))

const reasonBox = () => screen.getByLabelText('どこが気になりましたか')
const sendButton = () => screen.getByRole('button', { name: '通報する' })

const renderDialog = (onSubmit: (input: ReportInput) => Promise<BoardResult<null>>) =>
  render(<ReportDialog open onOpenChange={() => {}} postId="p1" onSubmit={onSubmit} />)

describe('ReportDialog — 通報者は公開されない（D-BOARD-SIGNED の裏返し）', () => {
  it('誰が通報したかは本人にも他の人にも見えない、とその場で書く', () => {
    renderDialog(okSubmit())
    expect(
      screen.getByText('誰が通報したかは、書いた本人にも、ほかの人にも見えません。'),
    ).toBeInTheDocument()
  })

  it('書いた理由の届き先（運営だけ・本人には届かない）を入力欄のそばに書く', () => {
    renderDialog(okSubmit())
    expect(screen.getByText('運営だけが読みます。書いた人には届きません')).toBeInTheDocument()
  })
})

describe('ReportDialog — 「通報すると消える」と読めないこと（D-BOARD-REPORT）', () => {
  it('件数で自動的に消えないこと・運営が読んで決めることを書く', () => {
    renderDialog(okSubmit())
    expect(screen.getByText(/通報の数で自動的に消える仕組みにはしていません/)).toBeInTheDocument()
    expect(screen.getByText(/運営が読んで、非表示にするかどうかを\s*決めます/)).toBeInTheDocument()
  })

  it('通報が削除・非表示を約束する書き方をしていない', () => {
    const { container } = renderDialog(okSubmit())
    const text = container.textContent ?? ''
    // 「通報すると消えます」「削除されます」と読める断定を置かない
    expect(text).not.toMatch(/通報すると[^。]*消え(ます|る)/)
    expect(text).not.toMatch(/削除されます/)
  })

  it('通報したことも件数も、他人に見える数字としては出さない', () => {
    const { container } = renderDialog(okSubmit())
    expect(container.textContent ?? '').not.toMatch(/\d+件の通報/)
  })
})

describe('ReportDialog — 理由の入力', () => {
  it('上限は reportReason（500）で、入力欄にも同じ数を効かせる', () => {
    renderDialog(okSubmit())
    expect(reasonBox()).toHaveAttribute('maxlength', String(BOARD_LIMITS.reportReason))
    expect(screen.getByText(`0 / ${BOARD_LIMITS.reportReason}`)).toBeInTheDocument()
  })

  it('書いた分だけ字数が増える', () => {
    renderDialog(okSubmit())
    fireEvent.change(reasonBox(), { target: { value: 'あいうえお' } })
    expect(screen.getByText(`5 / ${BOARD_LIMITS.reportReason}`)).toBeInTheDocument()
  })

  it('空のままでは送れない', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    expect(sendButton()).toBeDisabled()

    // 空白だけも空と同じ（trim して判定する）
    fireEvent.change(reasonBox(), { target: { value: '   ' } })
    expect(sendButton()).toBeDisabled()
    fireEvent.click(sendButton())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('定型の理由は押すと本文に入り、二度押しても同じ行は増えない', () => {
    renderDialog(okSubmit())
    const preset = REPORT_PRESETS[0] as string

    fireEvent.click(screen.getByRole('button', { name: preset }))
    expect(reasonBox()).toHaveValue(preset)

    fireEvent.click(screen.getByRole('button', { name: preset }))
    expect(reasonBox()).toHaveValue(preset)
  })

  it('定型の理由を足しても上限は超えない', () => {
    renderDialog(okSubmit())
    const preset = REPORT_PRESETS[0] as string
    const nearlyFull = 'あ'.repeat(BOARD_LIMITS.reportReason - 1)

    fireEvent.change(reasonBox(), { target: { value: nearlyFull } })
    fireEvent.click(screen.getByRole('button', { name: preset }))

    expect(reasonBox()).toHaveValue(nearlyFull)
  })
})

describe('ReportDialog — 送信', () => {
  it('前後の空白を落とした理由と postId を送り、成功したら閉じる', async () => {
    const onSubmit = okSubmit()
    const onOpenChange = vi.fn()
    render(<ReportDialog open onOpenChange={onOpenChange} postId="p1" onSubmit={onSubmit} />)

    fireEvent.change(reasonBox(), { target: { value: '  宣伝が連投されています  ' } })
    fireEvent.click(sendButton())

    expect(onSubmit).toHaveBeenCalledWith({ postId: 'p1', reason: '宣伝が連投されています' })
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('送信に失敗しても、書いた文章を消さず理由だけ出す', async () => {
    const message = '短い時間に操作が続きました。1分ほど待ってから、もう一度お試しください'
    const onOpenChange = vi.fn()
    render(
      <ReportDialog
        open
        onOpenChange={onOpenChange}
        postId="p1"
        onSubmit={failSubmit('rate_limited', message, 429)}
      />,
    )

    fireEvent.change(reasonBox(), { target: { value: '差別的な表現があります' } })
    fireEvent.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(reasonBox()).toHaveValue('差別的な表現があります')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('配線が例外を投げても、次の一手だけ伝えて入力は残す', async () => {
    const onSubmit = vi.fn(async (): Promise<BoardResult<null>> => {
      throw new Error('boom')
    })
    renderDialog(onSubmit)

    fireEvent.change(reasonBox(), { target: { value: 'なりすましです' } })
    fireEvent.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '送信できませんでした。通信を確かめて、もう一度お試しください',
    )
    expect(reasonBox()).toHaveValue('なりすましです')
  })

  it('送信中は二重送信しない', () => {
    const onSubmit = vi.fn(() => new Promise<BoardResult<null>>(() => {}))
    renderDialog(onSubmit)

    fireEvent.change(reasonBox(), { target: { value: '個人情報が書かれています' } })
    fireEvent.click(sendButton())

    const sending = screen.getByRole('button', { name: '送信中…' })
    expect(sending).toBeDisabled()
    fireEvent.click(sending)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
