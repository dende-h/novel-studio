import { useEffect, useId, useState } from 'react'
import {
  BOARD_LIMITS,
  BOARD_STATUSES,
  type BoardPost,
  type BoardStatus,
  type BoardThread,
  hasStatusUi,
  type ModerateInput,
  type ThreadPatchInput,
} from '@/core/board/types'
import { cn } from '@/lib/utils'
import { STATUS_UI } from '@/ui/board/board-ui'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Card } from '@/ui/components/ui/card'
import { Input } from '@/ui/components/ui/input'
import { Separator } from '@/ui/components/ui/separator'

/**
 * 運営（staff）だけに見える操作（設計 09-board §5・§8.2）。
 *
 * 判断の置き場を 3 つ決めてある。
 *
 * 1. **staff かどうかは props で受ける。** `useAuth()` は Clerk のログイン状態しか知らず、
 *    掲示板の立場は `board_profiles.role`（＝画面が `fetchMe` で引く）にしかない。
 *    ここで認証を読むと、判定が画面とこの部品の 2 か所に散る。
 * 2. **成否の文言は呼び出し側。** `onPatch` / `onModerate` は `Promise<void>` で受け、
 *    トーストもエラー表示も画面本体が出す（`PollCard` の `onVote` と同じ約束）。
 *    措置ごとに違う文言をここで持つと、API の増減に合わせて 2 か所を直すことになる。
 * 3. **投稿禁止だけ `ConfirmDialog` を通す。** 非表示・ピン・ロックは同じ画面から戻せるが、
 *    投稿禁止は相手の書き込みを期間まるごと止める。押し間違いの重さが違う。
 *
 * 対象の指し方は `postId`。掲示板 API はどのレスポンスにも `user_id` を返さない（§5）ので、
 * 画面が荒らしを指す手段は「その投稿の id」しかない。サーバが投稿から投稿者を引く。
 */

const DAY = 24 * 60 * 60 * 1000

/**
 * 投稿禁止の期間。サーバは**未来の期限**（`bannedUntil > now`）しか受け取らないので、
 * 画面は「いつまで」ではなく「どれだけ」を選ばせ、押した時刻に足して送る。
 * 恒久の禁止は置かない（`banned_until` は過ぎれば自然に明ける欄で、永久を表す値が無い）。
 */
export const BAN_DURATIONS: readonly { label: string; ms: number }[] = [
  { label: '1日', ms: DAY },
  { label: '7日', ms: 7 * DAY },
  { label: '30日', ms: 30 * DAY },
  { label: '1年', ms: 365 * DAY },
]

const DEFAULT_BAN_MS = 7 * DAY

// ---------------------------------------------------------------------------
// スレッド（ステータス・ピン・ロック・スレごと非表示）
// ---------------------------------------------------------------------------

export interface StaffControlsProps {
  /** 画面が `fetchMe` の `profile.role` で判定した結果。false なら何も描かない */
  staff: boolean
  thread: BoardThread
  /** ステータス・ピン・ロックの更新。**渡さなかった欄は据え置き**（`ThreadPatchInput`） */
  onPatch: (patch: ThreadPatchInput) => Promise<void>
  /** 運営の措置。ここで使うのは `hide_thread` / `unhide_thread` */
  onModerate: (input: ModerateInput) => Promise<void>
  className?: string
}

export function StaffControls({
  staff,
  thread,
  onPatch,
  onModerate,
  className,
}: StaffControlsProps) {
  const [status, setStatus] = useState<BoardStatus>(thread.status)
  const [note, setNote] = useState(thread.statusNote)
  const [version, setVersion] = useState(thread.shippedVersion)
  const [busy, setBusy] = useState(false)
  // label と input を id で結ぶ（label が Input コンポーネントを包む形だと、
  // 支援技術も lint も関連付けを追えない）。
  const noteId = useId()
  const versionId = useId()

  // 送信が通ると親が新しいスレを渡してくる。フォームをそれに合わせ直す＝
  // 画面の値とサーバの値が黙ってずれた状態を作らない。
  useEffect(() => {
    setStatus(thread.status)
    setNote(thread.statusNote)
    setVersion(thread.shippedVersion)
  }, [thread.status, thread.statusNote, thread.shippedVersion])

  if (!staff) return null

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } catch {
      // 失敗の文言は呼び出し側が出す。ここは送信中の表示を戻すだけ。
    } finally {
      setBusy(false)
    }
  }

  const withStatus = hasStatusUi(thread.kind)
  const dirty =
    status !== thread.status ||
    note.trim() !== thread.statusNote ||
    (status === 'shipped' && version.trim() !== thread.shippedVersion)

  const applyStatus = () => {
    // 触っていない欄は送らない（省略＝据え置き）。`shippedVersion` を実装済み以外でも
    // 送ると、見送りに変えたときに過去のリリース版が消える。
    const patch: ThreadPatchInput = { status, statusNote: note.trim() }
    if (status === 'shipped') patch.shippedVersion = version.trim()
    void run(() => onPatch(patch))
  }

  return (
    <Card className={cn('gap-3 border-primary/30 px-4 py-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-primary text-primary-foreground">運営</Badge>
        <span className="text-on-surface-variant text-xs">この欄は運営にだけ見えています</span>
      </div>

      {withStatus && (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-on-surface text-sm">対応の状況</span>
          {/* ステータスは「言えば直る」を見せる欄（D-BOARD-STATUS）。押した時点では送らず、
              一言とリリース版までまとめて 1 回で反映する。 */}
          <fieldset className="flex min-w-0 flex-wrap gap-1.5" disabled={busy}>
            <legend className="sr-only">運営ステータスを選ぶ</legend>
            {BOARD_STATUSES.map((value) => (
              <ToggleChip
                key={value === '' ? 'unset' : value}
                label={value === '' ? '未設定' : STATUS_UI[value].label}
                active={status === value}
                disabled={busy}
                onClick={() => setStatus(value)}
              />
            ))}
          </fieldset>

          <label className="flex flex-col gap-1.5" htmlFor={noteId}>
            <span className="text-on-surface-variant text-xs">添える一言（任意）</span>
            <Input
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={BOARD_LIMITS.statusNote}
              disabled={busy}
              placeholder="次の更新で直します"
            />
          </label>

          {/* 実装済みのときだけリリース版を聞く。掲示板がそのまま変更履歴になる（D-BOARD-STATUS）。 */}
          {status === 'shipped' && (
            <label className="flex flex-col gap-1.5" htmlFor={versionId}>
              <span className="text-on-surface-variant text-xs">リリース版</span>
              <Input
                id={versionId}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                maxLength={40}
                disabled={busy}
                placeholder="v1.4.0"
              />
            </label>
          )}

          <div>
            <Button type="button" size="sm" onClick={applyStatus} disabled={busy || !dirty}>
              状況を反映する
            </Button>
          </div>
        </div>
      )}

      {withStatus && <Separator />}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => onPatch({ pinned: !thread.pinned }))}
        >
          {thread.pinned ? '固定を外す' : '先頭に固定する'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => onPatch({ locked: !thread.locked }))}
        >
          {thread.locked ? '書き込みを再開する' : '書き込みを終了する'}
        </Button>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <span className="font-medium text-on-surface text-sm">スレッドの表示</span>
        {/* タイトルは `board_threads.title` の欄で、本文（seq=1）を非表示にしても一覧に残る（§5）。
            タイトルごと下ろす手段がここに無いと、最後の手段が D1 への直接 UPDATE しか残らない。
            いまどちらの状態かはレスポンスに無いので（`BoardThread` に hidden が無い）、
            両方を並べて出す。 */}
        <p className="text-on-surface-variant text-xs leading-5">
          本文を非表示にしても、タイトルは一覧に残ります。タイトルごと下ろすときはこちら。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() => onModerate({ action: 'hide_thread', threadId: thread.id }))
            }
          >
            一覧から下ろす
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() => onModerate({ action: 'unhide_thread', threadId: thread.id }))
            }
          >
            一覧に戻す
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 投稿 1 件（非表示・投稿禁止）
// ---------------------------------------------------------------------------

export interface StaffPostControlsProps {
  /** 画面が `fetchMe` の `profile.role` で判定した結果。false なら何も描かない */
  staff: boolean
  post: BoardPost
  onModerate: (input: ModerateInput) => Promise<void>
  /** 期限の基準時刻。テストから固定できるように受け取る（省略時は押した瞬間の時刻） */
  now?: number
  className?: string
}

/**
 * 投稿 1 件に添える運営の操作。**投稿ごとに並べる**のは、投稿禁止の対象を `postId` でしか
 * 指せないため（§5）。荒らしを止める導線が「その投稿の横」以外に作れない。
 */
export function StaffPostControls({
  staff,
  post,
  onModerate,
  now,
  className,
}: StaffPostControlsProps) {
  const [banMs, setBanMs] = useState<number>(DEFAULT_BAN_MS)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!staff) return null

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } catch {
      // 失敗の文言は呼び出し側が出す。
    } finally {
      setBusy(false)
    }
  }

  const banLabel = BAN_DURATIONS.find((d) => d.ms === banMs)?.label ?? ''

  const ban = () => {
    // 期限は押した瞬間からの相対で組む。ダイアログを開いたまま置かれても、
    // 送るときに数え直すので「過去の期限」になって 400 で弾かれることがない。
    const base = now ?? Date.now()
    void run(() => onModerate({ action: 'ban_user', postId: post.id, bannedUntil: base + banMs }))
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-2.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-primary text-primary-foreground">運営</Badge>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() =>
              onModerate({ action: post.hidden ? 'unhide_post' : 'hide_post', postId: post.id }),
            )
          }
        >
          {post.hidden ? '表示に戻す' : '非表示にする'}
        </Button>
        {/* 解除は可逆で、押し間違えても誰も止まらない。確認は挟まない。
            いま止めているかどうかはレスポンスに無い（投稿者の `bannedUntil` は返らない）ので、
            止めるボタンと並べて常に出す。 */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => onModerate({ action: 'unban_user', postId: post.id }))}
        >
          書き込みを再開させる
        </Button>
      </div>

      <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5" disabled={busy}>
        <legend className="text-on-surface-variant text-xs">この人の書き込みを止める期間</legend>
        {BAN_DURATIONS.map((d) => (
          <ToggleChip
            key={d.label}
            label={d.label}
            active={banMs === d.ms}
            disabled={busy}
            onClick={() => setBanMs(d.ms)}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-error"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          書き込みを止める
        </Button>
      </fieldset>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="この人の書き込みを止めますか？"
        description={`${banLabel}のあいだ、掲示板に書き込めなくなります。これまでの投稿は残ります。`}
        confirmLabel="止める"
        onConfirm={ban}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 共通の小片
// ---------------------------------------------------------------------------

/**
 * 押して選ぶチップ。`KindFilter` の `FilterChip`（`thread-list.tsx`）と同じ見た目を、
 * 運営の操作でも使う。あちらは種別の絞り込み専用で export されていないので、
 * 部品を跨いで持ち回るより同じ 10 行を持つほうが依存が素直になる。
 */
function ToggleChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low',
      )}
    >
      {label}
    </button>
  )
}
