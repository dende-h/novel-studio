import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BoardEventDetail } from '@/core/board/events'
import { AuthContext, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import { EventFormDialog, ShareEvent } from './event-form-dialog'
import { EventHeader, EventParticipants } from './event-view'

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
it('参加者名を残し、正規化できる公開 HTTP(S) URL のみ描画する', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            nextCursor: null,
            participants: [
              {
                id: 'a',
                name: '正規化する参加者',
                workUrl: ' HTTPS://Example.COM:443/a/../novel ',
              },
              { id: 'b', name: '欠落した参加者' },
              { id: 'c', name: '壊れた参加者', workUrl: 'not-a-url' },
              {
                id: 'd',
                name: '認証情報を含む参加者',
                workUrl: 'https://user:pass@example.com/novel',
              },
              { id: 'e', name: '非HTTPの参加者', workUrl: 'javascript:alert(1)' },
              { id: 'f', name: '文字列でない参加者', workUrl: 42 },
            ],
          }),
          { status: 200 },
        ),
    ),
  )
  render(
    <EventParticipants
      threadId="t1"
      version={NOW}
      count={6}
      staff={false}
      getToken={async () => null}
    />,
  )
  expect(await screen.findByRole('link', { name: '作品を読む（example.com）' })).toHaveAttribute(
    'href',
    'https://example.com/novel',
  )
  expect(screen.getAllByRole('link')).toHaveLength(1)
  for (const name of [
    '欠落した参加者',
    '壊れた参加者',
    '認証情報を含む参加者',
    '非HTTPの参加者',
    '文字列でない参加者',
  ]) {
    expect(screen.getByText(name)).toBeInTheDocument()
  }
})

it('新規と開催前の編集で明示した過去の開始日時を、送信前に拒否する', () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const onCreate = vi.fn()
  const onEdit = vi.fn()
  const dialog = render(
    <EventFormDialog onCreate={onCreate} onClose={vi.fn()} onOpenThread={vi.fn()} />,
  )
  fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '企画' } })
  fireEvent.change(screen.getByLabelText('説明'), { target: { value: '説明' } })
  fireEvent.click(screen.getByLabelText('今すぐ開始'))
  fireEvent.change(screen.getByLabelText('開始日時（JST）'), {
    target: { value: '2026-11-27T23:45' },
  })
  fireEvent.click(screen.getByRole('button', { name: '公開する' }))
  expect(screen.getByRole('alert')).toHaveTextContent('開始日時は現在より前にできません')
  expect(onCreate).not.toHaveBeenCalled()
  dialog.unmount()

  render(
    <EventFormDialog
      existing={{ title: '企画', body: '説明', event: event({ startsAt: NOW + 60_000 }) }}
      onEdit={onEdit}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('開始日時（JST）'), {
    target: { value: '2026-11-27T23:45' },
  })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  expect(screen.getByLabelText('開始日時（JST）')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('alert')).toHaveTextContent('開始日時は現在より前にできません')
  expect(onEdit).not.toHaveBeenCalled()
})

it('開催中の文面編集で開始の秒・ミリ秒と編集開始時のリビジョンを保持する', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const onEdit = vi.fn(async () => ({ ok: true as const, data: null }))
  const existing = { title: '企画', body: '説明', event: event({ startsAt: NOW - 1234 }) }
  const dialog = (revision: number) => (
    <EventFormDialog
      existing={{ ...existing, event: { ...existing.event, revision } }}
      onEdit={onEdit}
      onClose={vi.fn()}
    />
  )
  const view = render(dialog(1))
  expect(screen.getByLabelText('開始日時（JST）')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('説明'), { target: { value: '更新した説明' } })
  fireEvent.change(screen.getByLabelText('終了日時（JST）'), {
    target: { value: '2026-11-28T02:00' },
  })
  view.rerender(dialog(2))
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  await waitFor(() =>
    expect(onEdit).toHaveBeenCalledWith({
      action: 'edit',
      title: '企画',
      body: '更新した説明',
      startsAt: NOW - 1234,
      endsAt: NOW + 7_200_000,
      revision: 1,
    }),
  )
})

it.each([
  ['参加を取り消す', '取り消す', 'DELETE'],
  ['イベントを中止', '中止する', 'PATCH'],
  ['イベントを編集', '変更を保存', 'PATCH'],
])('%s の保存中は参加取り消し・編集・中止を無効にする', async (action, confirm, method) => {
  let finish: ((result: Response) => void) | undefined
  const fetchMock = vi.fn(
    async () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const refresh = vi.fn(async () => {})
  render(
    <AuthContext.Provider value={{ ...GUEST_AUTH_STATE, isSignedIn: true, userId: 'host' }}>
      <EventHeader
        threadId="t1"
        title="企画"
        body="説明"
        host={{ displayName: '主催者', staff: false, retired: false }}
        event={event({ canEdit: true, canCancel: true, myParticipation: { workUrl: null } })}
        getToken={async () => 'jwt'}
        refresh={refresh}
        onRequireName={vi.fn()}
        joinIntent={false}
        banned={false}
      />
    </AuthContext.Provider>,
  )
  const controls = ['参加を取り消す', 'イベントを編集', 'イベントを中止'].map((name) =>
    screen.getByRole('button', { name }),
  )
  fireEvent.click(screen.getByRole('button', { name: action }))
  fireEvent.click(screen.getByRole('button', { name: confirm }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  for (const control of controls) expect(control).toBeDisabled()
  expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method }))
  await act(async () => {
    finish?.(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })
  expect(refresh).toHaveBeenCalledTimes(1)
  for (const control of controls) expect(control).toBeEnabled()
})
