import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BoardEventDetail } from '@/core/board/events'
import { AuthContext, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import { EventFormDialog, ShareEvent } from './event-form-dialog'
import { EventHeader } from './event-view'

const NOW = Date.UTC(2026, 10, 27, 15)
const event = (over: Partial<BoardEventDetail> = {}): BoardEventDetail => ({
  startsAt: NOW - 1000,
  endsAt: NOW + 3_600_000,
  cancelledAt: null,
  revision: 1,
  participantCount: 0,
  myParticipation: null,
  canParticipate: true,
  canEdit: false,
  canCancel: false,
  serverNow: NOW,
  ...over,
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('ひな形を編集でき、JSTの入力を保存して、公開完了から正規URLを共有できる', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const onCreate = vi.fn(async () => ({
    ok: true as const,
    data: { threadId: 'event-1', startsAt: NOW + 3_600_000, endsAt: NOW + 7_200_000 },
  }))
  const onOpenThread = vi.fn()
  render(<EventFormDialog onClose={vi.fn()} onOpenThread={onOpenThread} onCreate={onCreate} />)
  fireEvent.click(screen.getByRole('button', { name: 'お題で書く' }))
  expect((screen.getByLabelText('説明') as HTMLTextAreaElement).value).toContain('文字数の目安')
  fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '週末の千字小説' } })
  fireEvent.change(screen.getByLabelText('説明'), {
    target: { value: '千字程度の短編を持ち寄ります。' },
  })
  fireEvent.click(screen.getByLabelText('今すぐ開始'))
  fireEvent.change(screen.getByLabelText('開始日時（JST）'), {
    target: { value: '2026-11-28T01:00' },
  })
  fireEvent.change(screen.getByLabelText('終了日時（JST）'), {
    target: { value: '2026-11-28T02:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: '公開する' }))
  expect(await screen.findByText('イベントを公開しました')).toBeInTheDocument()
  expect(onCreate).toHaveBeenCalledWith({
    kind: 'event',
    title: '週末の千字小説',
    body: '千字程度の短編を持ち寄ります。',
    event: { requestId: expect.any(String), startsAt: NOW + 3_600_000, endsAt: NOW + 7_200_000 },
  })
  fireEvent.click(screen.getByRole('button', { name: '共有' }))
  expect(await screen.findByRole('button', { name: 'リンクをコピー' })).toBeInTheDocument()
})

it('端末への共有に企画名・JSTの期間・正規URLを渡し、コピーに失敗したら選択できるURLを表示する', async () => {
  const share = vi.fn(async () => {})
  vi.stubGlobal('navigator', {
    ...navigator,
    share,
    clipboard: {
      writeText: vi.fn(async () => {
        throw new Error('blocked')
      }),
    },
  })
  render(<ShareEvent threadId="event-2" title="執筆会" schedule={event()} />)
  fireEvent.click(screen.getByRole('button', { name: '共有' }))
  fireEvent.click(screen.getByRole('button', { name: '端末の共有メニュー' }))
  expect(share).toHaveBeenCalledWith({
    title: '執筆会',
    text: expect.stringContaining('（JST）'),
    url: 'https://cotonoha-leaf.org/events/event-2',
  })
  fireEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }))
  expect(await screen.findByLabelText('共有 URL')).toHaveValue(
    'https://cotonoha-leaf.org/events/event-2',
  )
})

it('ゲストの参加導線はログイン後も希望を保持し、ボタンで確定するまで送信しない', async () => {
  const openSignIn = vi.fn()
  const refresh = vi.fn(async () => {})
  const request = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', request)
  const host = { displayName: '青井', staff: false, retired: false }
  const props = {
    threadId: 'event-3',
    title: '執筆会',
    body: '説明',
    host,
    event: event(),
    refresh,
    onRequireName: vi.fn(),
    getToken: async () => 'jwt',
    joinIntent: true,
    banned: false,
  }
  const view = render(
    <AuthContext.Provider value={{ ...GUEST_AUTH_STATE, available: true, openSignIn }}>
      <EventHeader {...props} />
    </AuthContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'ログインして参加へ進む' }))
  expect(openSignIn).toHaveBeenCalledTimes(1)
  view.rerender(
    <AuthContext.Provider value={{ ...GUEST_AUTH_STATE, isSignedIn: true, userId: 'member' }}>
      <EventHeader {...props} />
    </AuthContext.Provider>,
  )
  expect(request).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('公開作品の URL（任意）'), {
    target: { value: 'https://example.com/novel' },
  })
  fireEvent.click(screen.getByRole('button', { name: '参加を確定' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(request).toHaveBeenCalledWith(
    '/api/board/events/participation?thread=event-3',
    expect.objectContaining({ method: 'PUT', body: '{"workUrl":"https://example.com/novel"}' }),
  )
})
