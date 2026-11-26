import { Share2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import {
  type BoardEventDetail,
  eventPeriod,
  eventShareUrl,
  jstInputValue,
  parseJstInput,
} from '@/core/board/events'
import { BOARD_LIMITS, type CreateThreadInput, type EventPatchInput } from '@/core/board/types'
import type { BoardResult } from '@/ui/_api/board'
import { copyText } from '@/ui/_utils/clipboard'
import { useToast } from '@/ui/components/Toast/toast'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/components/ui/dialog'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'

const templates = [
  { label: '空欄から', body: '' },
  {
    label: 'お題で書く',
    body: 'お題：\n文字数の目安：\n作品の持ち寄り方：公開した作品の URL を参加欄に登録してください。',
  },
  {
    label: '感想交換',
    body: '交換する作品：\n感想を書く場所：このスレッドに返信してください。\n感想で触れてほしい点：',
  },
  { label: '執筆会', body: '今日書くもの：\n進み具合を共有する時間：\n途中参加・退出について：' },
] as const

type EditableEvent = { title: string; body: string; event: BoardEventDetail }
type PublishedEvent = {
  id: string
  title: string
  schedule: { startsAt: number; endsAt: number; cancelledAt: null }
}
type EventFormProps = {
  onClose: () => void
} & (
  | {
      existing?: undefined
      onCreate: (
        input: CreateThreadInput,
      ) => Promise<BoardResult<{ threadId: string; startsAt?: number; endsAt?: number }>>
      onOpenThread: (id: string) => void
    }
  | { existing: EditableEvent; onEdit: (input: EventPatchInput) => Promise<BoardResult<null>> }
)

export function EventFormDialog(props: EventFormProps) {
  const initial = props.existing
  const clockOffset = useRef(initial ? initial.event.serverNow - Date.now() : 0)
  const [requestId] = useState(() => crypto.randomUUID())
  const [ready, setReady] = useState<PublishedEvent | null>(null)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [startsNow, setStartsNow] = useState(!initial)
  const [start, setStart] = useState(() =>
    jstInputValue(initial?.event.startsAt ?? Date.now() + 3_600_000),
  )
  const [end, setEnd] = useState(() =>
    jstInputValue(initial?.event.endsAt ?? Date.now() + 7_200_000),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const prefix = useId()

  const submit = async () => {
    if (pending.current || !title.trim() || !body.trim()) return
    const now = Date.now() + clockOffset.current
    const startsAt =
      initial && start === jstInputValue(initial.event.startsAt)
        ? initial.event.startsAt
        : parseJstInput(start)
    const endsAt =
      initial && end === jstInputValue(initial.event.endsAt)
        ? initial.event.endsAt
        : parseJstInput(end)
    if (
      (!startsNow && startsAt === null) ||
      endsAt === null ||
      endsAt <= (startsNow ? now : (startsAt ?? 0)) ||
      endsAt <= now
    ) {
      setError('開始より後の、これからの終了日時を指定してください。')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (props.existing) {
        if (startsAt === null) return
        const result = await props.onEdit({
          action: 'edit',
          title,
          body,
          startsAt,
          endsAt,
          revision: props.existing.event.revision,
        })
        if (result.ok) props.onClose()
        else setError(result.message)
      } else {
        const result = await props.onCreate({
          kind: 'event',
          title,
          body,
          event: {
            requestId,
            startsAt: startsNow ? 'now' : (startsAt ?? now),
            endsAt,
          },
        })
        if (result.ok)
          setReady({
            id: result.data.threadId,
            title: title.trim(),
            schedule: {
              startsAt: result.data.startsAt ?? (startsNow ? now : (startsAt ?? now)),
              endsAt: result.data.endsAt ?? endsAt,
              cancelledAt: null,
            },
          })
        else setError(result.message)
      }
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ready ? 'イベントを公開しました' : initial ? 'イベントを編集' : 'イベントを作る'}
          </DialogTitle>
          <DialogDescription>
            {ready ? ready.title : '開催日時は日本時間（JST）で指定してください。'}
          </DialogDescription>
        </DialogHeader>
        {ready && !props.existing ? (
          <div className="flex flex-wrap gap-2">
            <ShareEvent threadId={ready.id} title={ready.title} schedule={ready.schedule} />
            <Button onClick={() => props.onOpenThread(ready.id)}>イベントを見る</Button>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {!initial && (
              <fieldset className="flex flex-wrap gap-1">
                <legend className="sr-only">ひな形</legend>
                {templates.map((template) => (
                  <Button
                    key={template.label}
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={() => setBody(template.body)}
                  >
                    {template.label}
                  </Button>
                ))}
              </fieldset>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={prefix + '-title'}>タイトル</Label>
              <Input
                id={prefix + '-title'}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
                required
                maxLength={BOARD_LIMITS.title}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={prefix + '-body'}>説明</Label>
              <Textarea
                id={prefix + '-body'}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy}
                required
                maxLength={BOARD_LIMITS.body}
                rows={5}
              />
            </div>
            {!initial && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={startsNow}
                  onChange={(event) => setStartsNow(event.target.checked)}
                  disabled={busy}
                />
                今すぐ開始
              </label>
            )}
            {!startsNow && (
              <div className="grid gap-1.5">
                <Label htmlFor={prefix + '-start'}>開始日時（JST）</Label>
                <Input
                  id={prefix + '-start'}
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  required
                  disabled={
                    busy ||
                    Boolean(initial && Date.now() + clockOffset.current >= initial.event.startsAt)
                  }
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={prefix + '-end'}>終了日時（JST）</Label>
              <Input
                id={prefix + '-end'}
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
                disabled={busy}
              />
            </div>
            {error && (
              <p role="alert" className="text-error text-sm">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={props.onClose} disabled={busy}>
                キャンセル
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? '保存中…' : initial ? '変更を保存' : '公開する'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ShareEvent({
  threadId,
  title,
  schedule,
}: {
  threadId: string
  title: string
  schedule: Parameters<typeof eventPeriod>[0]
}) {
  const toast = useToast()
  const url = eventShareUrl(threadId, window.location.origin)
  const inputId = useId()
  const [manualCopy, setManualCopy] = useState(false)
  const [shareError, setShareError] = useState('')
  return (
    <Dialog
      onOpenChange={() => {
        setManualCopy(false)
        setShareError('')
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Share2 aria-hidden className="size-4" />
          共有
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>イベントを共有</DialogTitle>
          <DialogDescription>
            {title} · {eventPeriod(schedule)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              if (await copyText(url)) toast.show('リンクをコピーしました')
              else setManualCopy(true)
            }}
          >
            リンクをコピー
          </Button>
          {typeof navigator.share === 'function' && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.share({ title, text: eventPeriod(schedule), url })
                } catch (error) {
                  if (!(error instanceof Error && error.name === 'AbortError')) {
                    setShareError('共有できませんでした。リンクをコピーして共有できます。')
                  }
                }
              }}
            >
              端末の共有メニュー
            </Button>
          )}
        </div>
        {shareError && (
          <p role="alert" className="text-error text-sm">
            {shareError}
          </p>
        )}
        {manualCopy && (
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>共有 URL</Label>
            <Input id={inputId} readOnly value={url} onFocus={(event) => event.target.select()} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
