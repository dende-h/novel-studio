import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { BOARD_SILENT_MS } from '@/core/board/notifications'
import {
  BoardNotificationsProvider,
  useBoardNotifications,
} from '@/ui/board/board-notifications-provider'
import { BoardNotificationBell, SidebarNotificationToggle } from './board-notifications'

const NOW = Date.UTC(2026, 10, 27)
const data = (ids: string[], silentUntil: number | null = null, serverNow = NOW) => ({
  scope: 'all',
  unreadThreadIds: ids,
  silentUntil,
  serverNow,
})
const ack = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const token = async () => 'jwt'
let savedVisibility: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  savedVisibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => {
  savedVisibility.mockRestore()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function Probe({ children }: { children?: ReactNode }) {
  const controls = useBoardNotifications()
  const [text, setText] = useState('')
  return (
    <>
      <BoardNotificationBell />
      <SidebarNotificationToggle />
      {controls?.unread.has('t1') && <span>スレッドの未読</span>}
      <label>
        ローカル入力
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {children}
    </>
  )
}
const show = (userId: string | null) => (
  <BoardNotificationsProvider userId={userId} getToken={token}>
    <Probe />
  </BoardNotificationsProvider>
)

it('表示中の一覧とバッジを即座に隠し、取得途中の旧応答を無視して、途中解除で未読を取り直す', async () => {
  let stopped = false
  let finishStop!: () => void
  let finishOld!: () => void
  let summaries = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/silent')) {
        if (options.method === 'DELETE') {
          stopped = false
          return ack({ silentUntil: null, serverNow: NOW })
        }
        return await new Promise<Response>((resolve) => {
          finishStop = () => {
            stopped = true
            resolve(ack({ silentUntil: NOW + BOARD_SILENT_MS, serverNow: NOW }))
          }
        })
      }
      if (url.endsWith('?summary=1')) {
        summaries++
        if (summaries === 2)
          return await new Promise<Response>((resolve) => {
            finishOld = () => resolve(ack(data(['t1', 't2'])))
          })
        return ack(stopped ? data([], NOW + BOARD_SILENT_MS) : data(['t1']))
      }
      return ack({
        ...data(['t1']),
        notifications: [
          {
            id: 1,
            threadId: 't1',
            title: '通知の行',
            actorName: '書き手',
            kind: 'reply',
            createdAt: NOW,
            postSeq: 7,
            unread: true,
          },
        ],
        nextCursor: null,
        readToken: 'signed',
      })
    }),
  )

  render(show('account-a'))
  fireEvent.click(await screen.findByRole('button', { name: '通知、未読 1 スレッド' }))
  expect(await screen.findByRole('link', { name: /通知の行/ })).toHaveAttribute(
    'href',
    '#/board/t1?post=7',
  )
  fireEvent.focus(window)
  await waitFor(() => expect(finishOld).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: '通知を24時間オフ' }))
  expect(screen.queryByRole('link', { name: /通知の行/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^通知、未読/ })).toBeNull()
  expect(screen.queryByText('スレッドの未読')).toBeNull()
  await waitFor(() => expect(finishStop).toBeTypeOf('function'))
  await act(async () => {
    finishOld()
    finishStop()
  })
  await waitFor(() => expect(screen.getByRole('button', { name: '通知を再開' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '通知を再開' }))
  expect(await screen.findByRole('button', { name: '通知、未読 1 スレッド' })).toBeInTheDocument()
  expect(screen.getByText('スレッドの未読')).toBeInTheDocument()
})

it('停止の保存に失敗すると表示を戻し、アカウントを変えても編集中の画面を再マウントしない', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/silent')) return ack({ error: 'server_error' }, 500)
      return ack(data(['t1']))
    }),
  )
  const view = render(show('account-a'))
  const stop = await screen.findByRole('button', { name: '通知を24時間オフ' })
  fireEvent.change(screen.getByLabelText('ローカル入力'), { target: { value: '編集中' } })
  fireEvent.click(stop)
  expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした')
  expect(screen.getByText('スレッドの未読')).toBeInTheDocument()

  view.rerender(show(null))
  expect(screen.queryByText('スレッドの未読')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByLabelText('ローカル入力')).toHaveValue('編集中')
})

it('サーバー時刻との差から停止期限に概要を再取得する', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const request = vi.fn(async () =>
    ack(
      Date.now() < NOW + 1500
        ? data([], NOW + BOARD_SILENT_MS, NOW + BOARD_SILENT_MS - 1500)
        : data(['t1'], null, NOW + BOARD_SILENT_MS),
    ),
  )
  vi.stubGlobal('fetch', request)
  render(show('account-a'))
  await act(async () => {})
  expect(screen.getByRole('button', { name: '通知を再開' })).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(screen.getByRole('button', { name: '通知、未読 1 スレッド' })).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})
