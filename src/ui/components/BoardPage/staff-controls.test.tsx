import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardPost, BoardThread, ModerateInput, ThreadPatchInput } from '@/core/board/types'
import { BAN_DURATIONS, StaffControls, StaffPostControls } from './staff-controls'

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

const threadOf = (over: Partial<BoardThread> = {}): BoardThread => ({
  id: 't1',
  kind: 'request',
  title: '章ごとの文字数を出してほしい',
  author: { displayName: '青井', staff: false, retired: false },
  mine: false,
  status: '',
  statusNote: '',
  shippedVersion: '',
  pinned: false,
  locked: false,
  replyCount: 1,
  likeCount: 3,
  liked: false,
  hasPoll: false,
  excerpt: '',
  createdAt: NOW - DAY,
  bumpedAt: NOW - 60_000,
  deleted: false,
  ...over,
})

const postOf = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: 'p1',
  threadId: 't1',
  seq: 2,
  author: { displayName: '青井', staff: false, retired: false },
  mine: false,
  body: '話ごとではなく章ごとに知りたいです',
  replyTo: 0,
  deleted: false,
  hidden: false,
  createdAt: NOW - DAY,
  links: [],
  ...over,
})

const noop = async () => {}

/**
 * 送った中身を記録するだけのハンドラ。引数の型を明示するのは、
 * 「どの欄を送ったか」を型ごと固定するため（省略＝据え置きの patch は、
 * 余計な欄が混ざっていないことまで見て初めて確かめたことになる）。
 */
const patchSpy = () => vi.fn(async (_patch: ThreadPatchInput) => {})
const moderateSpy = () => vi.fn(async (_input: ModerateInput) => {})

describe('StaffControls — staff にだけ見える（§8.2）', () => {
  it('staff でなければ何も描かない', () => {
    const onPatch = patchSpy()
    const { container } = render(
      <StaffControls staff={false} thread={threadOf()} onPatch={onPatch} onModerate={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('staff には、この欄が運営にだけ見えていることを添える', () => {
    render(<StaffControls staff thread={threadOf()} onPatch={noop} onModerate={noop} />)
    expect(screen.getByText('この欄は運営にだけ見えています')).toBeInTheDocument()
  })
})

describe('StaffControls — 運営ステータス（D-BOARD-STATUS）', () => {
  it('要望・不具合にだけステータス欄を出す', () => {
    const { rerender } = render(
      <StaffControls
        staff
        thread={threadOf({ kind: 'request' })}
        onPatch={noop}
        onModerate={noop}
      />,
    )
    expect(screen.getByText('対応の状況')).toBeInTheDocument()

    rerender(
      <StaffControls staff thread={threadOf({ kind: 'chat' })} onPatch={noop} onModerate={noop} />,
    )
    expect(screen.queryByText('対応の状況')).toBeNull()
  })

  it('選んだステータスと一言で onPatch を呼ぶ（触っていない欄は送らない）', () => {
    const onPatch = patchSpy()
    render(<StaffControls staff thread={threadOf()} onPatch={onPatch} onModerate={noop} />)

    fireEvent.click(screen.getByRole('button', { name: '検討中' }))
    fireEvent.change(screen.getByLabelText('添える一言（任意）'), {
      target: { value: ' 次の更新で直します ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '状況を反映する' }))

    expect(onPatch).toHaveBeenCalledWith({ status: 'reviewing', statusNote: '次の更新で直します' })
  })

  it('変えていないうちは反映できない', () => {
    const onPatch = patchSpy()
    render(
      <StaffControls
        staff
        thread={threadOf({ status: 'reviewing', statusNote: 'いま見ています' })}
        onPatch={onPatch}
        onModerate={noop}
      />,
    )
    const apply = screen.getByRole('button', { name: '状況を反映する' })
    expect(apply).toBeDisabled()
    fireEvent.click(apply)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('実装済みのときだけリリース版を聞き、その値を添えて送る', () => {
    const onPatch = patchSpy()
    render(<StaffControls staff thread={threadOf()} onPatch={onPatch} onModerate={noop} />)

    expect(screen.queryByLabelText('リリース版')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '実装済み' }))
    fireEvent.change(screen.getByLabelText('リリース版'), { target: { value: ' v1.4.0 ' } })
    fireEvent.click(screen.getByRole('button', { name: '状況を反映する' }))

    expect(onPatch).toHaveBeenCalledWith({
      status: 'shipped',
      statusNote: '',
      shippedVersion: 'v1.4.0',
    })
  })

  it('実装済み以外に変えるときは shippedVersion を送らない（過去のリリース版を消さない）', () => {
    const onPatch = patchSpy()
    render(
      <StaffControls
        staff
        thread={threadOf({ status: 'shipped', shippedVersion: 'v1.4.0' })}
        onPatch={onPatch}
        onModerate={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '今回は見送り' }))
    fireEvent.click(screen.getByRole('button', { name: '状況を反映する' }))

    expect(onPatch).toHaveBeenCalledWith({ status: 'declined', statusNote: '' })
  })

  it('未設定へ戻せる', () => {
    const onPatch = patchSpy()
    render(
      <StaffControls
        staff
        thread={threadOf({ status: 'planned' })}
        onPatch={onPatch}
        onModerate={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '未設定' }))
    fireEvent.click(screen.getByRole('button', { name: '状況を反映する' }))

    expect(onPatch).toHaveBeenCalledWith({ status: '', statusNote: '' })
  })

  it('親が新しいスレを渡してきたら、フォームをその値に合わせ直す', () => {
    const { rerender } = render(
      <StaffControls staff thread={threadOf()} onPatch={noop} onModerate={noop} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '受付' }))
    expect(screen.getByRole('button', { name: '受付' })).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <StaffControls
        staff
        thread={threadOf({ status: 'planned', statusNote: '次の更新で' })}
        onPatch={noop}
        onModerate={noop}
      />,
    )
    expect(screen.getByRole('button', { name: '対応予定' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('添える一言（任意）')).toHaveValue('次の更新で')
  })
})

describe('StaffControls — ピン・ロック・スレッドの表示', () => {
  it('先頭に固定する（pinned だけを送る）', () => {
    const onPatch = patchSpy()
    render(<StaffControls staff thread={threadOf()} onPatch={onPatch} onModerate={noop} />)

    fireEvent.click(screen.getByRole('button', { name: '先頭に固定する' }))
    expect(onPatch).toHaveBeenCalledWith({ pinned: true })
  })

  it('固定済みなら、外す側のボタンを出して逆の値を送る', () => {
    const onPatch = patchSpy()
    render(
      <StaffControls
        staff
        thread={threadOf({ pinned: true })}
        onPatch={onPatch}
        onModerate={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '固定を外す' }))
    expect(onPatch).toHaveBeenCalledWith({ pinned: false })
  })

  it('書き込みを終了する（locked だけを送る）', () => {
    const onPatch = patchSpy()
    render(<StaffControls staff thread={threadOf()} onPatch={onPatch} onModerate={noop} />)

    fireEvent.click(screen.getByRole('button', { name: '書き込みを終了する' }))
    expect(onPatch).toHaveBeenCalledWith({ locked: true })
  })

  it('終了済みなら、再開の側を出して逆の値を送る', () => {
    const onPatch = patchSpy()
    render(
      <StaffControls
        staff
        thread={threadOf({ locked: true })}
        onPatch={onPatch}
        onModerate={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '書き込みを再開する' }))
    expect(onPatch).toHaveBeenCalledWith({ locked: false })
  })

  it('送信が返るまでは、続けて押しても二重に送らない', () => {
    const onPatch = vi.fn((_patch: ThreadPatchInput) => new Promise<void>(() => {}))
    render(<StaffControls staff thread={threadOf()} onPatch={onPatch} onModerate={noop} />)

    fireEvent.click(screen.getByRole('button', { name: '先頭に固定する' }))
    fireEvent.click(screen.getByRole('button', { name: '書き込みを終了する' }))

    expect(onPatch).toHaveBeenCalledTimes(1)
  })

  it('スレッドごと一覧から下ろせる（hide_thread）', () => {
    const onModerate = moderateSpy()
    render(<StaffControls staff thread={threadOf()} onPatch={noop} onModerate={onModerate} />)

    fireEvent.click(screen.getByRole('button', { name: '一覧から下ろす' }))
    expect(onModerate).toHaveBeenCalledWith({ action: 'hide_thread', threadId: 't1' })
  })

  it('下ろしたスレッドを一覧に戻せる（unhide_thread）', () => {
    const onModerate = moderateSpy()
    render(<StaffControls staff thread={threadOf()} onPatch={noop} onModerate={onModerate} />)

    fireEvent.click(screen.getByRole('button', { name: '一覧に戻す' }))
    expect(onModerate).toHaveBeenCalledWith({ action: 'unhide_thread', threadId: 't1' })
  })

  it('ステータスの付かない種別でも、スレッドの表示は操作できる', () => {
    const onModerate = moderateSpy()
    render(
      <StaffControls
        staff
        thread={threadOf({ kind: 'chat' })}
        onPatch={noop}
        onModerate={onModerate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '一覧から下ろす' }))
    expect(onModerate).toHaveBeenCalledWith({ action: 'hide_thread', threadId: 't1' })
  })
})

describe('StaffPostControls — 投稿 1 件への措置', () => {
  it('staff でなければ何も描かない', () => {
    const { container } = render(
      <StaffPostControls staff={false} post={postOf()} onModerate={noop} now={NOW} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('投稿を非表示にする（hide_post）', () => {
    const onModerate = moderateSpy()
    render(<StaffPostControls staff post={postOf()} onModerate={onModerate} now={NOW} />)

    fireEvent.click(screen.getByRole('button', { name: '非表示にする' }))
    expect(onModerate).toHaveBeenCalledWith({ action: 'hide_post', postId: 'p1' })
  })

  it('非表示の投稿には、表示に戻す側を出す（unhide_post）', () => {
    const onModerate = moderateSpy()
    render(
      <StaffPostControls staff post={postOf({ hidden: true })} onModerate={onModerate} now={NOW} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '表示に戻す' }))
    expect(onModerate).toHaveBeenCalledWith({ action: 'unhide_post', postId: 'p1' })
  })

  it('投稿禁止は確認を経ないと呼ばない', () => {
    const onModerate = moderateSpy()
    render(<StaffPostControls staff post={postOf()} onModerate={onModerate} now={NOW} />)

    fireEvent.click(screen.getByRole('button', { name: '書き込みを止める' }))
    expect(onModerate).not.toHaveBeenCalled()
    expect(screen.getByText('この人の書き込みを止めますか？')).toBeInTheDocument()
  })

  it('確認をキャンセルすれば呼ばれない', () => {
    const onModerate = moderateSpy()
    render(<StaffPostControls staff post={postOf()} onModerate={onModerate} now={NOW} />)

    fireEvent.click(screen.getByRole('button', { name: '書き込みを止める' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onModerate).not.toHaveBeenCalled()
  })

  it('確認したら、既定の 7 日ぶんの期限を付けて ban_user を送る', () => {
    const onModerate = moderateSpy()
    render(<StaffPostControls staff post={postOf()} onModerate={onModerate} now={NOW} />)

    fireEvent.click(screen.getByRole('button', { name: '書き込みを止める' }))
    fireEvent.click(screen.getByRole('button', { name: '止める' }))

    expect(onModerate).toHaveBeenCalledWith({
      action: 'ban_user',
      postId: 'p1',
      bannedUntil: NOW + 7 * DAY,
    })
  })

  it('選んだ期間ぶんの期限を送る（確認の文にもその期間が出る）', () => {
    const onModerate = moderateSpy()
    render(<StaffPostControls staff post={postOf()} onModerate={onModerate} now={NOW} />)

    fireEvent.click(screen.getByRole('button', { name: '30日' }))
    fireEvent.click(screen.getByRole('button', { name: '書き込みを止める' }))
    expect(screen.getByText(/30日のあいだ、掲示板に書き込めなくなります/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    expect(onModerate).toHaveBeenCalledWith({
      action: 'ban_user',
      postId: 'p1',
      bannedUntil: NOW + 30 * DAY,
    })
  })

  it('用意する期間は BAN_DURATIONS のぶんだけで、恒久の禁止は置かない', () => {
    render(<StaffPostControls staff post={postOf()} onModerate={noop} now={NOW} />)
    for (const d of BAN_DURATIONS) {
      expect(screen.getByRole('button', { name: d.label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /永久|無期限/ })).toBeNull()
  })

  it('解除は確認を挟まずに送れる（可逆なので止めない）', () => {
    const onModerate = moderateSpy()
    render(<StaffPostControls staff post={postOf()} onModerate={onModerate} now={NOW} />)

    fireEvent.click(screen.getByRole('button', { name: '書き込みを再開させる' }))
    expect(onModerate).toHaveBeenCalledWith({ action: 'unban_user', postId: 'p1' })
  })

  it('対象は postId で指す（画面は user_id を持たない・§5）', () => {
    const onModerate = moderateSpy()
    render(
      <StaffPostControls staff post={postOf({ id: 'p9' })} onModerate={onModerate} now={NOW} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '書き込みを止める' }))
    fireEvent.click(screen.getByRole('button', { name: '止める' }))

    const input = onModerate.mock.calls[0]?.[0]
    expect(input).toMatchObject({ postId: 'p9' })
    expect(input).not.toHaveProperty('userId')
  })
})
