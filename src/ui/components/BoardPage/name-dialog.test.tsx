import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardResult } from '@/ui/_api/board'
import { NameDialog } from './name-dialog'

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

/** 成功する送信。`setDisplayName` と同じく例外は投げず Result を返す。 */
const okSubmit = () => vi.fn(async (): Promise<BoardResult<unknown>> => ({ ok: true, data: null }))

/** 失敗する送信（サーバが返した code / message をそのまま渡す形）。 */
const failSubmit = (code: string, message: string, status: number) =>
  vi.fn(async (): Promise<BoardResult<unknown>> => ({ ok: false, code, message, status }))

const nameInput = () => screen.getByLabelText('表示名')
const submitButton = () => screen.getByRole('button', { name: 'この名前にする' })

/** 24 文字ちょうど（上限）と、1 文字だけ超えた名前。 */
const AT_LIMIT = 'あ'.repeat(24)
const OVER_LIMIT = 'あ'.repeat(25)

describe('NameDialog — 記名式であることを伝える（D-BOARD-SIGNED）', () => {
  it('この名前で表示されること・過去の書き込みにも及ぶことを画面に書く', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    expect(screen.getByText(/ここで決めた名前が、書き込みと一緒に表示されます/)).toBeInTheDocument()
    expect(
      screen.getByText(/変えると、これまでの書き込みの名前も新しい名前になります/),
    ).toBeInTheDocument()
  })

  it('公開範囲を、ガイドライン・プライバシーポリシーと同じ強さで書く', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    // `public/board-guidelines.html` §1・`public/privacy.html` の掲示板の項と同じ言い方。
    // 「公開されます」で濁さず、**ログインしていない人を含め誰でも読める**まで書く。
    // ダイアログはポータルで body 直下に出るので、render の container では拾えない。
    expect(document.body.textContent ?? '').toContain('ログインしていない人を含め、誰でも読めます')
  })

  it('本名を使わないよう、名前を決めるその場で言う', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    expect(screen.getByText(/本名など、知られたくないものは使わないでください/)).toBeInTheDocument()
  })

  it('公開範囲の断りは、入力の指摘が出ているあいだも消えない', () => {
    // 補足文は指摘と入れ替わる（同じ場所を使う）。公開範囲だけは説明文の側に置いてあり、
    // 名前を弾かれている最中でも読める＝同意の前提が画面から消えない。
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    fireEvent.change(nameInput(), { target: { value: '運営' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(document.body.textContent ?? '').toContain('ログインしていない人を含め、誰でも読めます')
  })

  it('開いた直後は、まだ何も入力していない人を叱らない', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    expect(screen.queryByRole('alert')).toBeNull()
    // 空欄のままでは送れない（押せる形にしておいて弾かない）
    expect(submitButton()).toBeDisabled()
  })
})

describe('NameDialog — 手元で弾く（validateDisplayName の理由ごとに文言が違う）', () => {
  it('予約語（運営）は弾き、理由を出す', () => {
    const onSubmit = okSubmit()
    render(<NameDialog open onOpenChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: '運営' } })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'この名前は使えません。ほかの名前でお試しください',
    )
    expect(submitButton()).toBeDisabled()
    fireEvent.click(submitButton())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('見た目を変えた予約語（全角・空白入り）も同じ鍵に畳んで弾く', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    fireEvent.change(nameInput(), { target: { value: 'ａｄｍｉｎ' } })
    expect(screen.getByRole('alert')).toHaveTextContent('この名前は使えません')
  })

  it('上限（24文字）を超えると弾き、文字数も超過として出す', () => {
    const onSubmit = okSubmit()
    render(<NameDialog open onOpenChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: OVER_LIMIT } })

    expect(screen.getByRole('alert')).toHaveTextContent('表示名は24文字までです')
    expect(screen.getByText('25/24')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    fireEvent.click(submitButton())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('上限ちょうど（24文字）は通す', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    fireEvent.change(nameInput(), { target: { value: AT_LIMIT } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(submitButton()).toBeEnabled()
  })

  it('数えるのは保存される形（正規化後）＝前後の空白では上限を超えない', () => {
    render(<NameDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    fireEvent.change(nameInput(), { target: { value: `   ${AT_LIMIT}   ` } })
    expect(screen.getByText('24/24')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('NameDialog — 送信', () => {
  it('正規化した名前を送り、成功したら閉じる', async () => {
    const onSubmit = okSubmit()
    const onOpenChange = vi.fn()
    render(<NameDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: '  青井　　みどり  ' } })
    fireEvent.click(submitButton())

    // 連続空白は 1 つに畳み、前後は落とす（normalizeDisplayName と同じ形で送る）
    expect(onSubmit).toHaveBeenCalledWith('青井 みどり')
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('初期値を入力欄に詰めて、そのまま送れる', () => {
    const onSubmit = okSubmit()
    render(<NameDialog open onOpenChange={() => {}} initialName="青井" onSubmit={onSubmit} />)
    expect(nameInput()).toHaveValue('青井')
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith('青井')
  })

  it('サーバの 409（すでに使われています）を画面に出し、閉じず、入力も消さない', async () => {
    const message = 'この表示名は、すでに使われています。ほかの名前でお試しください'
    const onSubmit = failSubmit('duplicate', message, 409)
    const onOpenChange = vi.fn()
    render(<NameDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: '青井' } })
    fireEvent.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(nameInput()).toHaveValue('青井')
  })

  it('名前を書き換えると、前の往復で返ってきた重複の指摘は消える', async () => {
    const onSubmit = failSubmit('duplicate', 'この表示名は、すでに使われています', 409)
    render(<NameDialog open onOpenChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: '青井' } })
    fireEvent.click(submitButton())
    await screen.findByRole('alert')

    fireEvent.change(nameInput(), { target: { value: '青井 みどり' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('配線が例外を投げても、入力を巻き上げず通信の失敗として出す', async () => {
    const onSubmit = vi.fn(async (): Promise<BoardResult<unknown>> => {
      throw new Error('boom')
    })
    render(<NameDialog open onOpenChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: '青井' } })
    fireEvent.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('通信できませんでした')
    expect(nameInput()).toHaveValue('青井')
  })

  it('送信中は二重送信しない', () => {
    const onSubmit = vi.fn(() => new Promise<BoardResult<unknown>>(() => {}))
    render(<NameDialog open onOpenChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.change(nameInput(), { target: { value: '青井' } })
    fireEvent.click(submitButton())

    const sending = screen.getByRole('button', { name: '送信中…' })
    expect(sending).toBeDisabled()
    fireEvent.click(sending)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
