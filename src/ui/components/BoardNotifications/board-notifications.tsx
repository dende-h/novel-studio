import { Bell, BellOff } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useState } from 'react'
import { formatBoardJst } from '@/core/board/events'
import type { BoardNotification, BoardNotificationResponse } from '@/core/board/notifications'
import { useBoardNotifications } from '@/ui/board/board-notifications-provider'
import { Button } from '@/ui/components/ui/button'

const kindLabel: Record<BoardNotification['kind'], string> = {
  thread: '新しいスレッド',
  reply: '新しい返信',
  event_rescheduled: '開催日時の変更',
  event_cancelled: 'イベントの中止',
}

export function BoardNotificationBell() {
  const controls = useBoardNotifications()
  return controls?.scope && !controls.silentUntil ? <NotificationPopover /> : null
}

function NotificationPopover() {
  const controls = useBoardNotifications()
  const [open, setOpen] = useState(false)
  const count = controls?.unread.size ?? 0
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={count ? '通知、未読 ' + count + ' スレッド' : '通知'}
        >
          <Bell aria-hidden className="size-4" />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute right-0 top-0 rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          collisionPadding={8}
          sideOffset={8}
          aria-label="掲示板の通知"
          className="z-50 w-[min(25rem,calc(100vw-1rem))] rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-lg"
        >
          {open && <NotificationList />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function NotificationList() {
  const controls = useBoardNotifications()
  const list = controls?.list
  const [page, setPage] = useState<BoardNotificationResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: 再読み込みと既読後は同じ条件で一覧を取得する
  useEffect(() => {
    if (!list) return
    let active = true
    void list().then((result) => {
      if (!active) return
      if (result.ok) setPage(result.data)
      else setError(result.message)
    })
    return () => {
      active = false
    }
  }, [list, generation])

  const showMore = async () => {
    if (!controls || !page?.nextCursor || busy) return
    setBusy(true)
    const result = await controls.list(page.nextCursor)
    if (result.ok) {
      setPage({
        ...result.data,
        readToken: page.readToken,
        notifications: [
          ...(page.notifications ?? []),
          ...(result.data.notifications ?? []).filter(
            (row) => !page.notifications?.some((shown) => shown.threadId === row.threadId),
          ),
        ],
      })
    } else setError(result.message)
    setBusy(false)
  }

  const readAll = async () => {
    if (!controls || !page?.readToken || busy) return
    setError('')
    setBusy(true)
    const result = await controls.read(page.readToken)
    if (result.ok) {
      setPage(null)
      setGeneration((value) => value + 1)
    } else setError(result.message)
    setBusy(false)
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <h2 className="font-semibold text-sm">掲示板の通知</h2>
        {page?.readToken &&
          ((controls?.unread.size ?? 0) > 0 || page.notifications?.some((row) => row.unread)) && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void readAll()}>
              すべて既読
            </Button>
          )}
      </div>
      <div className="max-h-[min(55dvh,var(--radix-popover-content-available-height))] overflow-y-auto">
        {page?.notifications?.length ? (
          <ul>
            {page.notifications.map((row) => (
              <li key={row.id}>
                <Popover.Close asChild>
                  <a
                    href={
                      '#/board/' +
                      encodeURIComponent(row.threadId) +
                      (row.postSeq ? '?post=' + row.postSeq : '?activity=' + row.id)
                    }
                    className="block rounded-md px-2 py-2 hover:bg-surface-container-high"
                  >
                    <span className="flex items-baseline gap-2 break-all text-sm">
                      {row.unread && (
                        <span className="shrink-0 rounded bg-primary-container px-1 text-xs text-on-primary-container">
                          未読
                        </span>
                      )}
                      <span className={row.unread ? 'font-semibold' : undefined}>{row.title}</span>
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      {kindLabel[row.kind]} · {row.actorName} ·{' '}
                      <time dateTime={new Date(row.createdAt).toISOString()}>
                        {formatBoardJst(row.createdAt)}
                      </time>
                    </span>
                  </a>
                </Popover.Close>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-2 text-sm text-on-surface-variant">
            {page
              ? page.scope === 'off'
                ? '掲示板の通知はオフです。'
                : '通知はありません。'
              : error
                ? ''
                : '読み込み中…'}
          </p>
        )}
        {page?.nextCursor && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void showMore()}>
            もっと読む
          </Button>
        )}
      </div>
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
          {!page && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError('')
                setGeneration((value) => value + 1)
              }}
            >
              再読み込み
            </Button>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-outline-variant/40 px-2 pt-2 text-primary text-sm">
        <Popover.Close asChild>
          <a className="underline" href="#/settings/notifications">
            通知設定
          </a>
        </Popover.Close>
        <Popover.Close asChild>
          <a className="underline" href="#/board">
            掲示板へ
          </a>
        </Popover.Close>
      </div>
    </>
  )
}

export function SidebarNotificationToggle() {
  const controls = useBoardNotifications()
  if (!controls?.scope) return null
  const until = controls.silentUntil
  const Icon = until ? Bell : BellOff
  return (
    <div className="px-3">
      <button
        type="button"
        data-keep-nav-open="true"
        disabled={controls.saving}
        onClick={() => void controls.silence(!until)}
        className="flex w-full items-center gap-2.5 rounded-md py-2 text-left font-medium text-[13px] text-on-surface-variant hover:text-primary disabled:opacity-60"
      >
        <Icon aria-hidden className="size-[15px] shrink-0" />
        <span>{until ? '通知を再開' : '通知を24時間オフ'}</span>
      </button>
      {until && (
        <p className="pb-1 pl-6 text-xs text-on-surface-variant">
          {formatBoardJst(until)}（JST）まで
        </p>
      )}
      {controls.silenceError && (
        <p role="alert" className="pb-1 pl-6 text-error text-xs">
          {controls.silenceError}
        </p>
      )}
    </div>
  )
}
