import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardRole, CreateThreadInput } from '@/core/board/types'
import { BOARD_LIMITS, boardKindHint, boardKindLabel } from '@/core/board/types'
import type { BoardResult } from '@/ui/_api/board'
import { NewThreadDialog } from './new-thread-dialog'

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

const okSubmit = () => vi.fn(async (): Promise<BoardResult<unknown>> => ({ ok: true, data: null }))

const failSubmit = (code: string, message: string, status: number) =>
  vi.fn(async (): Promise<BoardResult<unknown>> => ({ ok: false, code, message, status }))

const renderDialog = (
  onSubmit: (input: CreateThreadInput) => Promise<BoardResult<unknown>>,
  role?: BoardRole,
) => render(<NewThreadDialog open onOpenChange={() => {}} onSubmit={onSubmit} role={role} />)

const titleBox = () => screen.getByLabelText('タイトル')
const bodyBox = () => screen.getByLabelText('本文')
const createButton = () => screen.getByRole('button', { name: '立てる' })

/** タイトルと本文だけ埋める（アンケートの検証を単独で見るための下ごしらえ）。 */
const fillRequired = () => {
  fireEvent.change(titleBox(), { target: { value: '章ごとの文字数を出してほしい' } })
  fireEvent.change(bodyBox(), { target: { value: '話ごとではなく章ごとに知りたいです' } })
}

/** アンケート欄を開く（開いた時点で空の選択肢 2 行と 7 日後の締切が入る）。 */
const openPoll = () => {
  fireEvent.click(screen.getByRole('switch', { name: 'アンケートを添える' }))
}

/** 締切の入力欄に入れる形（ローカル時刻の `YYYY-MM-DDTHH:mm`）。 */
const localValue = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const DAY = 24 * 60 * 60 * 1000

describe('NewThreadDialog — 種別（D-BOARD-KIND）', () => {
  it('種別を選べる（既定は要望で、押した種別に切り替わる）', () => {
    renderDialog(okSubmit())
    const request = screen.getByRole('button', { name: boardKindLabel.request })
    const bug = screen.getByRole('button', { name: boardKindLabel.bug })

    expect(request).toHaveAttribute('aria-pressed', 'true')
    expect(bug).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(bug)
    expect(bug).toHaveAttribute('aria-pressed', 'true')
    expect(request).toHaveAttribute('aria-pressed', 'false')
  })

  it('選んだ種別が、そのまま送信の kind になる', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)

    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.promo }))
    fillRequired()
    fireEvent.click(createButton())

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'promo' }))
  })

  it('種別ごとに、何を書く場所かの一言を出す（文言は契約側の boardKindHint）', () => {
    renderDialog(okSubmit())
    // 開いた直後＝要望
    expect(screen.getByText(boardKindHint.request)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.bug }))
    expect(screen.getByText(boardKindHint.bug)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.promo }))
    expect(screen.getByText(boardKindHint.promo)).toBeInTheDocument()
  })

  it('要望と不具合は、書くことの違いが一言で分かる', () => {
    renderDialog(okSubmit())
    // 「機能改善要望」「不具合報告」のような窓口語ではなく、利用者の言葉で言い切る
    expect(screen.getByText(/こうなったら嬉しい/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.bug }))
    expect(screen.getByText(/おかしな動きをした/)).toBeInTheDocument()
    // 不具合は再現手順が要る＝要望には無い情報。分けたままにした理由をここで固定する
    expect(screen.getByText(/再現する手順/)).toBeInTheDocument()
  })

  it('要望・不具合では 👍 と対応状況が付くと言い、雑談では言わない', () => {
    const { container } = renderDialog(okSubmit())
    expect(screen.getByText(/👍/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.bug }))
    expect(screen.getByText(/👍/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.chat }))
    expect(screen.getByText(/運営の対応状況は付きません/)).toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain('👍')
  })
})

describe('NewThreadDialog — 選べない種別は出さない', () => {
  it('「目安箱」は選択肢に無い（要望へ統合した）', () => {
    renderDialog(okSubmit())
    expect(screen.queryByRole('button', { name: '目安箱' })).toBeNull()
    // 統合したので「要望」のボタンは 1 つだけ（同じラベルが 2 つ並ばない）
    expect(screen.getAllByRole('button', { name: boardKindLabel.request })).toHaveLength(1)
  })

  it('member には「お知らせ」を出さない（押させてから 403 で断らない）', () => {
    renderDialog(okSubmit(), 'member')
    expect(screen.queryByRole('button', { name: boardKindLabel.notice })).toBeNull()
  })

  it('role を渡さない呼び出しも member 扱いにする（後方互換）', () => {
    render(<NewThreadDialog open onOpenChange={() => {}} onSubmit={okSubmit()} />)
    expect(screen.queryByRole('button', { name: boardKindLabel.notice })).toBeNull()
    expect(screen.getByRole('button', { name: boardKindLabel.request })).toBeInTheDocument()
  })

  it('staff なら「お知らせ」を選んで立てられる', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit, 'staff')

    const notice = screen.getByRole('button', { name: boardKindLabel.notice })
    fireEvent.click(notice)
    expect(notice).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(boardKindHint.notice)).toBeInTheDocument()

    fillRequired()
    fireEvent.click(createButton())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'notice' }))
  })
})

describe('NewThreadDialog — タイトルと本文', () => {
  it('押して初めて、足りない欄の理由が出る', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)

    // 開いた直後は赤くしない（これから書く人に何も伝えない指摘は出さない）
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(createButton())
    expect(screen.getByText('タイトルを入力してください')).toBeInTheDocument()
    expect(screen.getByText('本文を入力してください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('上限を超えたタイトルは送らない', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)

    fireEvent.change(titleBox(), { target: { value: 'あ'.repeat(BOARD_LIMITS.title + 1) } })
    fireEvent.change(bodyBox(), { target: { value: '本文' } })
    fireEvent.click(createButton())

    expect(screen.getByText(`タイトルは${BOARD_LIMITS.title}文字までです`)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('前後の空白を落とした本文を送る（アンケート無しなら poll は付けない）', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)

    fireEvent.change(titleBox(), { target: { value: '  題名  ' } })
    fireEvent.change(bodyBox(), { target: { value: '  本文  ' } })
    fireEvent.click(createButton())

    expect(onSubmit).toHaveBeenCalledWith({ kind: 'request', title: '題名', body: '本文' })
  })
})

describe('NewThreadDialog — 文字数の数え方がサーバと一致する', () => {
  // サーバの `CreateThreadInputSchema` は `z.string().max()`＝UTF-16 の符号単位で数える。
  // 絵文字は 1 つで 2。カウンタがコードポイントで数えると、「上限内」と出ている本文が
  // `bad_request` で弾かれる（利用者から見れば理由の無い失敗）。
  const EMOJI = '😀'

  it('絵文字はサーバと同じく 2 と数える（コードポイントで数えない）', () => {
    renderDialog(okSubmit())
    fireEvent.change(titleBox(), { target: { value: EMOJI.repeat(3) } })
    expect(screen.getByText(`6/${BOARD_LIMITS.title}`)).toBeInTheDocument()
  })

  it('絵文字だけで上限に達した本文は、上限に達したと表示される', () => {
    renderDialog(okSubmit())
    // 絵文字を上限の半分の数だけ＝サーバ換算でちょうど上限。
    // コードポイントで数えると上限の半分に見える
    const value = EMOJI.repeat(BOARD_LIMITS.body / 2)
    fireEvent.change(bodyBox(), { target: { value } })
    expect(screen.getByText(`${BOARD_LIMITS.body}/${BOARD_LIMITS.body}`)).toBeInTheDocument()
  })

  it('絵文字で上限を超えた本文は、超過として弾く（サーバまで往復させない）', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fireEvent.change(titleBox(), { target: { value: '題名' } })
    fireEvent.change(bodyBox(), { target: { value: EMOJI.repeat(BOARD_LIMITS.body / 2 + 1) } })
    fireEvent.click(createButton())

    expect(screen.getByText(`本文は${BOARD_LIMITS.body}文字までです`)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('アンケートの質問も同じ単位で数える', () => {
    renderDialog(okSubmit())
    openPoll()
    fireEvent.change(screen.getByLabelText('質問'), { target: { value: EMOJI.repeat(2) } })
    expect(screen.getByText(`4/${BOARD_LIMITS.pollQuestion}`)).toBeInTheDocument()
  })
})

describe('NewThreadDialog — そもそも上限を超えて打てない（maxLength）', () => {
  it('タイトルと本文に、サーバと同じ上限の maxLength が付いている', () => {
    renderDialog(okSubmit())
    expect(titleBox()).toHaveAttribute('maxlength', String(BOARD_LIMITS.title))
    expect(bodyBox()).toHaveAttribute('maxlength', String(BOARD_LIMITS.body))
  })

  it('本文の上限は 1500 字（下げた上限にカウンタと maxLength が追従している）', () => {
    // 4000 字（原稿用紙 10 枚）から下げた。掲示板は拾い読みする器で、1 投稿がそこまで
    // 長いと読む側が先に疲れる。書き切れない話は返信で足せる。
    // 数字をここに直接書くのは、**上限を下げたことそのもの**を固定するため
    //（BOARD_LIMITS.body を写すだけだと、値が元に戻っても気づけない）。
    expect(BOARD_LIMITS.body).toBe(1500)

    renderDialog(okSubmit())
    expect(bodyBox()).toHaveAttribute('maxlength', '1500')

    fireEvent.change(bodyBox(), { target: { value: 'あ'.repeat(1500) } })
    expect(screen.getByText('1500/1500')).toBeInTheDocument()
  })

  it('かつて通った 4000 字の本文は、いまは手元で弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)

    fireEvent.change(titleBox(), { target: { value: '題名' } })
    fireEvent.change(bodyBox(), { target: { value: 'あ'.repeat(4000) } })
    fireEvent.click(createButton())

    expect(screen.getByText(`本文は${BOARD_LIMITS.body}文字までです`)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('アンケートの質問と選択肢にも上限が付いている', () => {
    renderDialog(okSubmit())
    openPoll()
    expect(screen.getByLabelText('質問')).toHaveAttribute(
      'maxlength',
      String(BOARD_LIMITS.pollQuestion),
    )
    expect(screen.getByLabelText('選択肢 1')).toHaveAttribute(
      'maxlength',
      String(BOARD_LIMITS.pollOption),
    )
  })

  it('上限を超えた値が入り込んでも、押した人は理由を読める（標準の検証に握りつぶさせない）', () => {
    // `maxLength` を付けた欄は、値が上限を超えているとブラウザ標準の検証が submit ごと
    // 止めてしまう（押しても何も起きない画面になる）。form の noValidate でこれを切り、
    // この画面の文言が必ず出るようにしてある。
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fireEvent.change(titleBox(), { target: { value: 'あ'.repeat(BOARD_LIMITS.title + 1) } })
    fireEvent.change(bodyBox(), { target: { value: '本文' } })
    fireEvent.click(createButton())

    expect(screen.getByText(`タイトルは${BOARD_LIMITS.title}文字までです`)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('NewThreadDialog — アンケート（送信前に手元で弾く）', () => {
  it('添えないうちは入力欄を出さない', () => {
    renderDialog(okSubmit())
    expect(screen.queryByLabelText('質問')).toBeNull()
    expect(screen.queryByLabelText('選択肢 1')).toBeNull()
  })

  it('選択肢が 2 未満だと弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    fireEvent.change(screen.getByLabelText('質問'), { target: { value: '次はどれを作りますか' } })
    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: '縦書きの校正' } })
    fireEvent.click(screen.getByRole('button', { name: '選択肢 2 を削除' }))
    fireEvent.click(createButton())

    expect(screen.getByText('選択肢は2つ以上にしてください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('選択肢が重複していると弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    fireEvent.change(screen.getByLabelText('質問'), { target: { value: '次はどれを作りますか' } })
    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: '縦書きの校正' } })
    // 前後の空白だけ違う選択肢も同じものとして弾く（票が割れると集計が壊れる）
    fireEvent.change(screen.getByLabelText('選択肢 2'), { target: { value: ' 縦書きの校正 ' } })
    fireEvent.click(createButton())

    expect(
      screen.getByText('同じ選択肢が2つあります。どちらかを書き直してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('空の選択肢があると弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    fireEvent.change(screen.getByLabelText('質問'), { target: { value: '次はどれを作りますか' } })
    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: '縦書きの校正' } })
    fireEvent.click(createButton())

    expect(
      screen.getByText('空の選択肢があります。入力するか、削除してください'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('締切が過去だと弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    fireEvent.change(screen.getByLabelText('質問'), { target: { value: '次はどれを作りますか' } })
    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: '縦書きの校正' } })
    fireEvent.change(screen.getByLabelText('選択肢 2'), { target: { value: 'スマホの編集' } })
    fireEvent.change(screen.getByLabelText('締め切り'), {
      target: { value: localValue(Date.now() - DAY) },
    })
    fireEvent.click(createButton())

    expect(screen.getByText('締め切りは、いまより先の日時にしてください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('締切が空でも弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    fireEvent.change(screen.getByLabelText('質問'), { target: { value: '次はどれを作りますか' } })
    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: '縦書きの校正' } })
    fireEvent.change(screen.getByLabelText('選択肢 2'), { target: { value: 'スマホの編集' } })
    fireEvent.change(screen.getByLabelText('締め切り'), { target: { value: '' } })
    fireEvent.click(createButton())

    expect(screen.getByText('締め切りを決めてください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('質問が空だと弾く', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: '縦書きの校正' } })
    fireEvent.change(screen.getByLabelText('選択肢 2'), { target: { value: 'スマホの編集' } })
    fireEvent.click(createButton())

    expect(screen.getByText('質問を入力してください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('選択肢は上限（8）まで増やせて、そこから先は増やせない', () => {
    renderDialog(okSubmit())
    openPoll()

    const add = screen.getByRole('button', { name: /選択肢を追加/ })
    for (let i = 2; i < BOARD_LIMITS.pollOptionCount; i += 1) fireEvent.click(add)

    expect(screen.getByLabelText(`選択肢 ${BOARD_LIMITS.pollOptionCount}`)).toBeInTheDocument()
    expect(add).toBeDisabled()
  })

  it('揃っていれば、整えたアンケートを添えて送る', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()

    const closesAt = Date.now() + 3 * DAY
    fireEvent.change(screen.getByLabelText('質問'), { target: { value: ' 次はどれを作りますか ' } })
    fireEvent.change(screen.getByLabelText('選択肢 1'), { target: { value: ' 縦書きの校正 ' } })
    fireEvent.change(screen.getByLabelText('選択肢 2'), { target: { value: 'スマホの編集' } })
    fireEvent.change(screen.getByLabelText('締め切り'), { target: { value: localValue(closesAt) } })
    fireEvent.click(screen.getByRole('switch', { name: 'いくつでも選べるようにする' }))
    fireEvent.click(createButton())

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'request',
      title: '章ごとの文字数を出してほしい',
      body: '話ごとではなく章ごとに知りたいです',
      poll: {
        question: '次はどれを作りますか',
        options: ['縦書きの校正', 'スマホの編集'],
        multiple: true,
        // 入力欄は分単位なので、秒以下を落とした値で比べる
        closesAt: new Date(localValue(closesAt)).getTime(),
      },
    })
  })

  it('アンケートを閉じれば、その中身では送信を止めない', () => {
    const onSubmit = okSubmit()
    renderDialog(onSubmit)
    fillRequired()
    openPoll()
    // 空の選択肢を残したまま閉じる
    openPoll()
    fireEvent.click(createButton())

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'request',
      title: '章ごとの文字数を出してほしい',
      body: '話ごとではなく章ごとに知りたいです',
    })
  })
})

describe('NewThreadDialog — 送信', () => {
  it('失敗したら理由を出し、閉じず、書いたものを残す', async () => {
    const message = 'スレッドは1日に10本までです。時間をおいてから、もう一度お試しください'
    const onSubmit = failSubmit('too_many_threads', message, 429)
    const onOpenChange = vi.fn()
    render(<NewThreadDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    fillRequired()
    fireEvent.click(createButton())

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(titleBox()).toHaveValue('章ごとの文字数を出してほしい')
    expect(bodyBox()).toHaveValue('話ごとではなく章ごとに知りたいです')
  })

  it('配線が例外を投げても、書いたものを巻き上げない', async () => {
    const onSubmit = vi.fn(async (): Promise<BoardResult<unknown>> => {
      throw new Error('boom')
    })
    renderDialog(onSubmit)

    fillRequired()
    fireEvent.click(createButton())

    expect(await screen.findByText(/通信できませんでした/)).toBeInTheDocument()
    expect(bodyBox()).toHaveValue('話ごとではなく章ごとに知りたいです')
  })

  it('送信中は二重送信しない', () => {
    const onSubmit = vi.fn(() => new Promise<BoardResult<unknown>>(() => {}))
    renderDialog(onSubmit)

    fillRequired()
    fireEvent.click(createButton())

    const sending = screen.getByRole('button', { name: '送信中…' })
    expect(sending).toBeDisabled()
    fireEvent.click(sending)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('成功したら閉じる', async () => {
    const onOpenChange = vi.fn()
    render(<NewThreadDialog open onOpenChange={onOpenChange} onSubmit={okSubmit()} />)

    fillRequired()
    fireEvent.click(createButton())

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
