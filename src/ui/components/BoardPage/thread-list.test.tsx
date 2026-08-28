import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardKind, BoardThread } from '@/core/board/types'
import { BOARD_KINDS, boardKindLabel, boardStatusLabel } from '@/core/board/types'
import { KindFilter, ThreadList, ThreadRow, threadHref } from './thread-list'

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0)

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
  replyCount: 0,
  likeCount: 0,
  liked: false,
  hasPoll: false,
  excerpt: '',
  createdAt: NOW - 86_400_000,
  bumpedAt: NOW - 60_000,
  deleted: false,
  ...over,
})

describe('ThreadRow — 行に出るもの', () => {
  it('タイトル・種別・投稿者・最終書き込み・返信数・抜粋を出す', () => {
    render(
      <ThreadRow
        thread={threadOf({
          replyCount: 12,
          excerpt: '## 見出し\n\n話ごとではなく章ごとに知りたいです',
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('章ごとの文字数を出してほしい')).toBeInTheDocument()
    expect(screen.getByText(boardKindLabel.request)).toBeInTheDocument()
    expect(screen.getByText('青井')).toBeInTheDocument()
    expect(screen.getByText('1分前')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    // 抜粋は記法の記号を落として 1 行に畳んだもの（excerptOf に委ねている）
    expect(screen.getByText('見出し 話ごとではなく章ごとに知りたいです')).toBeInTheDocument()
  })

  it('時刻が入っていないスレで 1970 年を出さない', () => {
    render(<ThreadRow thread={threadOf({ bumpedAt: 0 })} now={NOW} />)
    expect(screen.queryByText(/1970/)).toBeNull()
  })
})

describe('ThreadRow — 👍 と運営ステータスは要望・不具合だけ（D-BOARD-KIND）', () => {
  it('雑談スレには 👍 もステータスも出ない', () => {
    render(
      <ThreadRow
        thread={threadOf({
          kind: 'chat',
          // サーバが誤って付けてきても画面は出さない（器のほうで絞る）
          status: 'reviewing',
          likeCount: 34,
          replyCount: 5,
        })}
        now={NOW}
      />,
    )
    expect(screen.queryByText(boardStatusLabel.reviewing)).toBeNull()
    expect(screen.queryByText('賛同')).toBeNull()
    expect(screen.queryByText('34')).toBeNull()
    // 返信数は種別によらず出る
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('自己紹介・作品紹介・目安箱にも出ない', () => {
    for (const kind of ['intro', 'promo', 'suggestion'] as const) {
      const { unmount } = render(
        <ThreadRow thread={threadOf({ kind, status: 'planned', likeCount: 7 })} now={NOW} />,
      )
      expect(screen.queryByText(boardStatusLabel.planned)).toBeNull()
      expect(screen.queryByText('賛同')).toBeNull()
      unmount()
    }
  })

  it('要望スレには 👍 とステータスが出る', () => {
    render(
      <ThreadRow
        thread={threadOf({ kind: 'request', status: 'reviewing', likeCount: 34 })}
        now={NOW}
      />,
    )
    expect(screen.getByText(boardStatusLabel.reviewing)).toBeInTheDocument()
    expect(screen.getByText('賛同')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
  })

  it('不具合スレにも出る（👍 は 0 でも数を出す）', () => {
    render(<ThreadRow thread={threadOf({ kind: 'bug', status: 'received' })} now={NOW} />)
    expect(screen.getByText(boardStatusLabel.received)).toBeInTheDocument()
    expect(screen.getByText('賛同')).toBeInTheDocument()
  })

  it('ステータス未設定なら要望スレでもチップを出さない', () => {
    const { container } = render(<ThreadRow thread={threadOf({ status: '' })} now={NOW} />)
    // 種別チップだけ（空ラベルのチップが増えていない）
    const badges = container.querySelectorAll('[data-slot="badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]?.textContent).toBe(boardKindLabel.request)
  })

  it('実装済みにはリリース版を添える', () => {
    render(
      <ThreadRow thread={threadOf({ status: 'shipped', shippedVersion: 'v1.4.0' })} now={NOW} />,
    )
    expect(screen.getByText(/実装済み/)).toBeInTheDocument()
    expect(screen.getByText('v1.4.0')).toBeInTheDocument()
  })
})

describe('ThreadRow — 印', () => {
  it('ピン留めには印が出る（読み上げにも残す）', () => {
    render(<ThreadRow thread={threadOf({ pinned: true })} now={NOW} />)
    expect(screen.getByText('先頭に固定')).toBeInTheDocument()
  })

  it('ピン留めでなければ印は出ない', () => {
    render(<ThreadRow thread={threadOf()} now={NOW} />)
    expect(screen.queryByText('先頭に固定')).toBeNull()
  })

  it('ロック・アンケート・運営バッジを出す', () => {
    render(
      <ThreadRow
        thread={threadOf({
          locked: true,
          hasPoll: true,
          author: { displayName: 'コトノハ運営', staff: true, retired: false },
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('書き込み終了')).toBeInTheDocument()
    expect(screen.getByText('アンケート')).toBeInTheDocument()
    expect(screen.getByText('運営')).toBeInTheDocument()
  })
})

describe('ThreadRow — キーボードで辿れる', () => {
  it('行そのものがリンク（div の onClick ではない）', () => {
    const { container } = render(<ThreadRow thread={threadOf({ id: 'abc 1' })} now={NOW} />)
    const link = screen.getByRole('link', { name: /章ごとの文字数を出してほしい/ })
    expect(link.tagName).toBe('A')
    // id はエスケープしてから埋める
    expect(link.getAttribute('href')).toBe('#/board/abc%201')
    expect(threadHref('abc 1')).toBe('#/board/abc%201')
    // リンクの入れ子や、行内のボタンでフォーカス順が乱れていないこと
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })

  it('飛び先は差し替えられる', () => {
    render(<ThreadRow thread={threadOf()} now={NOW} href="#/board?id=t1" />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/board?id=t1')
  })
})

describe('ThreadList — 並び', () => {
  it('ピン留めを先頭に置き、それ以外の順番は崩さない', () => {
    const threads = [
      threadOf({ id: 'a', title: '雑談です', kind: 'chat' }),
      threadOf({ id: 'b', title: '目安箱', kind: 'suggestion', pinned: true }),
      threadOf({ id: 'c', title: 'あとの話' }),
      threadOf({ id: 'd', title: 'もう 1 本の固定', pinned: true }),
    ]
    render(<ThreadList threads={threads} now={NOW} />)
    const titles = screen
      .getAllByRole('link')
      .map((a) => within(a).getByRole('heading').textContent)
    expect(titles).toEqual(['目安箱', 'もう 1 本の固定', '雑談です', 'あとの話'])
  })

  it('行ごとにリンクが 1 本ずつ並ぶ', () => {
    render(<ThreadList threads={[threadOf({ id: 'a' }), threadOf({ id: 'b' })]} now={NOW} />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('差し替えた飛び先を各行へ渡す', () => {
    render(
      <ThreadList
        threads={[threadOf({ id: 'a' })]}
        now={NOW}
        hrefOf={(t) => `#/board/detail/${t.id}`}
      />,
    )
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/board/detail/a')
  })
})

describe('ThreadList — 空のときの案内（設計 §2 の過疎対策）', () => {
  it('1 本も無いときは次の一手を出す', () => {
    const onCreate = vi.fn()
    render(<ThreadList threads={[]} now={NOW} onCreate={onCreate} />)
    expect(
      screen.getByText(
        'うまく動かないところも、あったらいいなと思う機能も、ひとことから書けます。',
      ),
    ).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'スレッドを立てる' })
    fireEvent.click(button)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('絞り込みでゼロ件なら、その種別を名指しして絞り込みを外す道を出す', () => {
    const onClearKind = vi.fn()
    render(<ThreadList threads={[]} now={NOW} kind="chat" onClearKind={onClearKind} />)
    expect(
      screen.getByText(`${boardKindLabel.chat}のスレッドは、まだ 1 本もありません。`),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'すべての種別を見る' }))
    expect(onClearKind).toHaveBeenCalledTimes(1)
  })

  it('導線を渡さなければボタンを出さない（未ログインで書けないとき）', () => {
    render(<ThreadList threads={[]} now={NOW} />)
    expect(screen.queryByRole('button')).toBeNull()
    // 案内そのものは残す（何もない画面にしない）
    expect(screen.getByText(/ひとことから書けます。/)).toBeInTheDocument()
  })
})

describe('KindFilter', () => {
  it('すべて＋全種別を 1 度ずつ出す', () => {
    render(<KindFilter kind={null} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'すべて' })).toBeInTheDocument()
    for (const kind of BOARD_KINDS) {
      expect(screen.getByRole('button', { name: boardKindLabel[kind] })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button')).toHaveLength(BOARD_KINDS.length + 1)
  })

  it('選んでいるものだけ aria-pressed が立つ', () => {
    render(<KindFilter kind="bug" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: boardKindLabel.bug })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('押すとその種別を返し、もう一度押すと解除する', () => {
    const onChange = vi.fn<(kind: BoardKind | null) => void>()
    const { rerender } = render(<KindFilter kind={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.promo }))
    expect(onChange).toHaveBeenCalledWith('promo')

    rerender(<KindFilter kind="promo" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: boardKindLabel.promo }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('「すべて」で絞り込みを外せる', () => {
    const onChange = vi.fn<(kind: BoardKind | null) => void>()
    render(<KindFilter kind="intro" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
