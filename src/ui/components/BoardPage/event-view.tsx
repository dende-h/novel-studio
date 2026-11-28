import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  type BoardEventDetail,
  eventPeriod,
  eventStatusLabel,
  eventStatusOf,
  formatBoardJst,
  parseEventWorkUrl,
} from '@/core/board/events'
import type { BoardAuthor } from '@/core/board/types'
import {
  fetchEventParticipants,
  leaveBoardEvent,
  moderate,
  patchEvent,
  setEventWork,
} from '@/ui/_api/board'
import { useAuth } from '@/ui/auth/auth-context'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { EventFormDialog, ShareEvent } from './event-form-dialog'

type TokenGetter = () => Promise<string | null>

export function EventHeader({
  threadId,
  title,
  body,
  host,
  event,
  getToken,
  refresh,
  onRequireName,
  joinIntent,
  onJoinIntent,
  banned,
}: {
  threadId: string
  title: string
  body: string
  host: BoardAuthor
  event: BoardEventDetail
  getToken: TokenGetter
  refresh: () => Promise<void>
  onRequireName: () => void
  joinIntent: boolean
  onJoinIntent?: () => void
  banned: boolean
}) {
  const auth = useAuth()
  const fieldId = useId()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'cancel' | 'leave' | null>(null)
  const [showJoin, setShowJoin] = useState(joinIntent)
  useEffect(() => {
    if (joinIntent) setShowJoin(true)
  }, [joinIntent])
  const [showWork, setShowWork] = useState(false)
  const [workUrl, setWorkUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const timing = useMemo(() => ({ offset: event.serverNow - Date.now() }), [event.serverNow])
  const [clock, setClock] = useState(Date.now)
  const now = clock + timing.offset
  const status = eventStatusOf(event, now)
  const open = status === 'active' || status === 'upcoming'

  useEffect(() => {
    const tick = () => setClock(Date.now())
    tick()
    const estimatedNow = Date.now() + timing.offset
    const boundary = estimatedNow < event.startsAt ? event.startsAt : event.endsAt
    const wait = boundary - estimatedNow
    const change = wait > 0 && wait < 2_147_483_647 ? window.setTimeout(tick, wait) : undefined
    const interval = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearTimeout(change)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [event.startsAt, event.endsAt, timing])

  const run = async (action: 'join' | 'update' | 'remove' | 'cancel' | 'leave') => {
    if (pending.current) return
    if (!auth.isSignedIn) {
      auth.openSignIn()
      return
    }
    const raw = workUrl.trim()
    const url = raw ? parseEventWorkUrl(raw) : null
    if ((action === 'join' || action === 'update') && raw && !url) {
      setError('公開作品の HTTP または HTTPS の URL を入力してください。')
      return
    }
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const result =
        action === 'cancel'
          ? await patchEvent(threadId, { action: 'cancel' }, getToken)
          : action === 'leave'
            ? await leaveBoardEvent(threadId, getToken)
            : await setEventWork(
                threadId,
                getToken,
                action === 'remove' || (action === 'update' && !url) ? null : (url ?? undefined),
              )
      if (!result.ok) {
        if (result.code === 'profile_required') onRequireName()
        else if (result.code === 'unauthorized') auth.openSignIn()
        else setError(result.message)
        return
      }
      setShowJoin(false)
      setShowWork(false)
      setWorkUrl('')
      await refresh()
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  const minutes = Math.max(1, Math.ceil((event.endsAt - now) / 60_000))
  const remaining =
    minutes >= 1440
      ? '残り約' + Math.ceil(minutes / 1440) + '日'
      : minutes >= 60
        ? '残り約' + Math.ceil(minutes / 60) + '時間'
        : '残り約' + minutes + '分'
  const participation = event.myParticipation
  const formVisible =
    open && !banned && ((!participation && showJoin) || (participation && showWork))

  return (
    <section
      aria-label="イベント情報"
      className="mt-4 grid gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <strong className="rounded bg-primary-container px-2 py-1 text-on-primary-container">
          {eventStatusLabel[status]}
        </strong>
        <span>{eventPeriod(event)}</span>
        {status === 'active' && <span className="text-on-surface-variant">{remaining}</span>}
      </div>
      <p className="text-sm text-on-surface-variant">
        開催者 {host.displayName} · 参加 {event.participantCount} 人
      </p>
      {event.cancelledAt && (
        <p className="text-sm">
          このイベントは {formatBoardJst(event.cancelledAt)}（JST）に中止されました。
        </p>
      )}
      {(open || participation) && (
        <p className="text-xs text-on-surface-variant">
          参加すると、ペンネームと登録した作品 URL が公開されます。作品 URL は任意です。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!participation && open && !banned && !formVisible && (
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (!auth.isSignedIn) onJoinIntent?.()
              setWorkUrl('')
              setShowJoin(true)
            }}
          >
            参加する
          </Button>
        )}
        {participation && (
          <>
            <span className="self-center px-1 text-sm font-medium">参加中</span>
            {open && event.canParticipate && !formVisible && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setWorkUrl(participation.workUrl ?? '')
                  setShowWork(true)
                }}
              >
                作品 URL を編集
              </Button>
            )}
            {participation.workUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void run('remove')}
              >
                作品 URL を削除
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setConfirm('leave')}
            >
              参加を取り消す
            </Button>
          </>
        )}
        <ShareEvent threadId={threadId} title={title} schedule={event} />
        {event.canEdit && open && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => setEditing(true)}
          >
            イベントを編集
          </Button>
        )}
        {event.canCancel && open && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => setConfirm('cancel')}
          >
            イベントを中止
          </Button>
        )}
      </div>
      {banned && open && !participation && <p className="text-sm">投稿禁止中は参加できません。</p>}
      {participation?.workUrl && participation.linkHidden && (
        <p className="text-sm">作品 URL は運営により非表示になっています。</p>
      )}
      {formVisible &&
        (auth.isSignedIn ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run(participation ? 'update' : 'join')
            }}
          >
            <Label htmlFor={fieldId}>公開作品の URL（任意）</Label>
            <Input
              id={fieldId}
              type="url"
              value={workUrl}
              maxLength={2048}
              placeholder="https://"
              onChange={(e) => setWorkUrl(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="submit" disabled={saving}>
                {participation ? '保存' : '参加を確定'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={saving}
                onClick={() => {
                  setShowJoin(false)
                  setShowWork(false)
                  setError('')
                }}
              >
                閉じる
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" className="justify-self-start" onClick={auth.openSignIn}>
            ログインして参加へ進む
          </Button>
        ))}
      {error && (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      )}
      {editing && (
        <EventFormDialog
          existing={{ title, body, event }}
          onClose={() => setEditing(false)}
          onEdit={async (patch) => {
            pending.current = true
            setSaving(true)
            try {
              const result = await patchEvent(threadId, patch, getToken)
              if (result.ok) await refresh()
              return result
            } finally {
              pending.current = false
              setSaving(false)
            }
          }}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) setConfirm(null)
        }}
        title={confirm === 'cancel' ? 'イベントを中止しますか？' : '参加を取り消しますか？'}
        description={
          confirm === 'cancel'
            ? '受付を終了し、イベントの詳細に中止のお知らせを表示します。'
            : 'ペンネームと作品 URL が参加者一覧から消えます。'
        }
        confirmLabel={confirm === 'cancel' ? '中止する' : '取り消す'}
        onConfirm={() => {
          if (confirm) void run(confirm)
        }}
      />
    </section>
  )
}

type Participants = Extract<
  Awaited<ReturnType<typeof fetchEventParticipants>>,
  { ok: true }
>['data']
export function EventParticipants({
  threadId,
  version,
  count,
  staff,
  onReport,
  getToken,
}: {
  threadId: string
  version: number
  count: number
  staff: boolean
  onReport?: (id: string) => void
  getToken: TokenGetter
}) {
  const [data, setData] = useState<Participants | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const epoch = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 詳細の再取得や再読み込みで参加者を更新する
  useEffect(() => {
    const request = ++epoch.current
    setBusy(false)
    setError('')
    if (count === 0) {
      setData(null)
      return
    }
    void fetchEventParticipants(threadId).then((result) => {
      if (request !== epoch.current) return
      if (result.ok) setData(result.data)
      else setError(result.message)
    })
    return () => {
      epoch.current++
    }
  }, [threadId, version, reload, count])

  const more = async () => {
    if (!data?.nextCursor || busy) return
    const request = epoch.current
    setBusy(true)
    setError('')
    const result = await fetchEventParticipants(threadId, data.nextCursor)
    if (request !== epoch.current) return
    setBusy(false)
    if (result.ok)
      setData({ ...result.data, participants: [...data.participants, ...result.data.participants] })
    else setError(result.message)
  }

  const hideLink = async (participantId: string) => {
    setBusy(true)
    const result = await moderate({ action: 'hide_participant_link', participantId }, getToken)
    setBusy(false)
    if (result.ok) setReload((n) => n + 1)
    else setError(result.message)
  }

  return (
    <section className="rounded-lg border border-outline-variant/40 p-3">
      <h2 className="font-semibold text-sm">参加者</h2>
      {count === 0 ? (
        <p className="mt-2 text-sm text-on-surface-variant">まだ参加者はいません。</p>
      ) : (
        <ul className="mt-1 divide-y divide-outline-variant/30">
          {data?.participants.map(({ id, name, workUrl }) => {
            const publicUrl = workUrl ? parseEventWorkUrl(workUrl) : null
            return (
              <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="break-all">{name}</span>
                {publicUrl && (
                  <>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-primary underline"
                    >
                      作品を読む（{new URL(publicUrl).hostname}）
                    </a>
                    {onReport && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onReport(id)}>
                        リンクを通報
                      </Button>
                    )}
                    {staff && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void hideLink(id)}
                      >
                        リンクを非表示
                      </Button>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {data?.nextCursor && (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void more()}>
          参加者をもっと読む
        </Button>
      )}
      {error && (
        <>
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setReload((n) => n + 1)}>
            再読み込み
          </Button>
        </>
      )}
    </section>
  )
}
