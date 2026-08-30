import { ArrowLeft, CornerDownRight, Lock, Pin, ThumbsUp } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { isStaffOnlyKind } from '@/core/board/permission'
import type {
  BoardMeResponse,
  BoardPost,
  BoardThread,
  BoardThreadDetail,
  ModerateInput,
  ReportInput,
  ThreadPatchInput,
} from '@/core/board/types'
import { BOARD_LIMITS, hasStatusUi } from '@/core/board/types'
import { cn } from '@/lib/utils'
import {
  boardErrorMessage,
  createPost,
  deletePost,
  deleteThread,
  fetchMe,
  fetchThread,
  moderate,
  patchThread,
  report,
  setDisplayName,
  toggleLike,
  vote,
} from '@/ui/_api/board'
import { formatCount } from '@/ui/_utils/format'
import { useAuth } from '@/ui/auth/auth-context'
import { formatBoardTime, KIND_UI, STATUS_UI } from '@/ui/board/board-ui'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { BoardBody } from '@/ui/components/BoardPage/board-body'
import { BoardLinkCard } from '@/ui/components/BoardPage/link-card'
import { NameDialog } from '@/ui/components/BoardPage/name-dialog'
import { PollCard } from '@/ui/components/BoardPage/poll-card'
import { ReportDialog } from '@/ui/components/BoardPage/report-dialog'
import { StaffControls, StaffPostControls } from '@/ui/components/BoardPage/staff-controls'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { type NavKey, SideNav } from '@/ui/components/SideNav/side-nav'
import { useToast } from '@/ui/components/Toast/toast'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'

/**
 * スレッド 1 本の画面（設計 09-board §2・`GET /api/board/thread?id=`）。
 *
 * 一覧（`thread-list.tsx`）が「表示だけ」の部品なのに対し、ここは**取得と送信を持つ画面**。
 * 掲示板の書き込み系はすべてこのスレの中で起きる（返信・削除・👍・投票・通報・運営の措置）ので、
 * API との配線を 1 か所にまとめ、部品には結果だけを渡す。
 *
 * 守っているのは 4 つ。
 *
 * 1. **未ログインでも読める**（§2）。トークンが無ければ `Authorization` を付けずに読み、
 *    書き込みの代わりにサインインの導線を出す。grove の読者が覗いて、書きたくなったら
 *    無料登録できる形にする。
 * 2. **書けるかどうかはサーバの `canPost` に従う。** 画面で組み直さない（判定が 2 か所に
 *    散ると必ず片方だけ緩む）。画面が足すのは「なぜ書けないか」の説明だけで、
 *    理由の並び順は `canPost`（未ログイン → 投稿禁止 → 削除済み → ロック）に揃える。
 * 3. **スレの削除は、消える範囲を先に伝える。** 返信が 1 件でもあれば本文だけが消え、
 *    返信は残る（D-BOARD-DELETE）。押したあとに知らせても取り返しがつかないので、
 *    確認ダイアログの説明文で先に言う。
 * 4. **削除・非表示の本文は組み立てない。** `BoardBody` が伏字に差し替える。サーバも
 *    伏字を返すが（§7-6）、画面でも同じ判断を持つ＝どちらかが緩んでも本文は漏れない。
 */

// ---------------------------------------------------------------------------
// 表示のヘルパ
// ---------------------------------------------------------------------------

/**
 * 投稿禁止の期限。**`formatBoardTime` は過去向け**で、未来を渡すと「たった今」に潰れる
 * （`formatRelative` が `now - at` を 0 で下げ止めるため）。期限は「いつまで」が要る情報なので、
 * ここだけ絶対表記で出す。`PollCard` の `formatRemaining` と同じ判断。
 */
function formatBanUntil(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

/** 返信番号の表記。`>>3` は掲示板の作法で、これ以外の書き方を混ぜない。 */
const replyLabel = (seq: number): string => `>>${seq}`

/**
 * 👍 を押せない理由（押せるなら空文字）。**押す相手は書き込み 1 件**（0009）。
 *
 * **サーバの `canLike`（`src/core/board/permission.ts`）と同じ順・同じ判定**で組む
 *（投稿禁止 → 削除済み → ロック）。ここを画面に持たないと、締め切ったスレに
 * 「押すたびに 403/409 のトーストが出るだけのボタン」が残る。判定が 2 か所に散るのは
 * 承知のうえで、**緩めるほうへはずれない並び**にして揃える。
 *
 * **未ログインは理由にしない。** サーバは 401 で弾くが、画面はそれを受けてログインの
 * ダイアログを出す＝押した先に次の一手がある。押せなくすると、その導線ごと消える。
 */
function likeBlockedReason(thread: BoardThread, banned: boolean): string {
  if (banned) return '運営の判断で、いまは賛同を付けられません'
  if (thread.deleted) return '削除されたスレッドには、賛同を付けられません'
  if (thread.locked) return '書き込みを終了したスレッドには、賛同を付けられません'
  return ''
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export interface ThreadViewProps {
  threadId: string
  /** 掲示板の一覧へ戻る */
  onBack: () => void
  /** マイライブラリへ（ブランド・サイドバー） */
  onNavigateCollection: () => void
  /** 執筆の記録へ（サイドバー） */
  onNavigateActivity?: () => void
  /** ネタ帳へ（サイドバー） */
  onNavigateIdeas?: () => void
  /** 掲示板の一覧へ（サイドバー）。`onBack` と行き先は同じだが、渡し口は分けておく */
  onNavigateBoard?: () => void
  /** 設定ページへ（サイドバーのフッター） */
  onNavigateSettings?: () => void
  /** ヘルプページへ（サイドバーのフッター） */
  onNavigateHelp?: () => void
  /**
   * `SideNav` で光らせる行。掲示板は `NavKey` にまだ無いので、**呼び出し側が持っている
   * キーをそのまま渡せる形**にしてある（キーが増えたら渡すだけで追従する）。
   */
  navActive?: NavKey
  /** 相対時刻の基準。テストから固定できるように受け取る */
  now?: number
}

export function ThreadView({
  threadId,
  onBack,
  onNavigateCollection,
  onNavigateActivity,
  onNavigateIdeas,
  onNavigateBoard,
  onNavigateSettings,
  onNavigateHelp,
  // 既定はスレ詳細の現在地＝掲示板。呼び出し側の書き忘れでマイライブラリが光らないようにする。
  navActive = 'board',
  now = Date.now(),
}: ThreadViewProps) {
  const auth = useAuth()
  const toast = useToast()
  // 投稿へ飛ぶためのアンカー。`useId` を混ぜて、同じ文書に 2 つ描かれても id が衝突しない形にする。
  const anchorPrefix = useId()
  const replyFieldId = useId()
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // Clerk の `getToken` は毎レンダー別の関数になりうる。そのまま依存に置くと読み込みが
  // 無限に走るので、参照を ref で束ねて呼び口だけ固定する（`clerk-gate.tsx` と同じ手当て）。
  const getTokenRef = useRef(auth.getToken)
  getTokenRef.current = auth.getToken
  const getToken = useCallback(async () => await getTokenRef.current(), [])

  const [detail, setDetail] = useState<BoardThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [me, setMe] = useState<BoardMeResponse | null>(null)

  const [replyBody, setReplyBody] = useState('')
  const [replyTo, setReplyTo] = useState(0)
  const [sending, setSending] = useState(false)
  const [formError, setFormError] = useState('')

  const [nameOpen, setNameOpen] = useState(false)
  const [reportTarget, setReportTarget] = useState('')
  const [confirmThread, setConfirmThread] = useState(false)
  const [confirmPost, setConfirmPost] = useState<BoardPost | null>(null)
  const [busy, setBusy] = useState(false)

  // 読み込みの世代。スレを切り替えたときに、前の応答が後から届いて上書きするのを防ぐ。
  const genRef = useRef(0)

  const load = useCallback(async () => {
    const gen = genRef.current + 1
    genRef.current = gen
    const res = await fetchThread(threadId, getToken)
    if (gen !== genRef.current) return
    setLoading(false)
    if (res.ok) {
      setDetail(res.data)
      setLoadError('')
      return
    }
    setDetail(null)
    setLoadError(res.message)
  }, [threadId, getToken])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // 自分の立場（運営かどうか・表示名の有無・投稿禁止）。**未ログインでは叩かない**
  // （`/api/board/me` は読み取りでもログインが要る唯一の窓口）。
  const loadMe = useCallback(async () => {
    if (!auth.isSignedIn) {
      setMe(null)
      return
    }
    const res = await fetchMe(getToken)
    if (res.ok) setMe(res.data)
  }, [auth.isSignedIn, getToken])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  const thread = detail?.thread ?? null
  const posts = detail?.posts ?? []
  const staff = me?.profile?.role === 'staff'
  // 運営以外にはお知らせの返信欄そのものを出さない（断り書きも出さない）。
  const replySectionHidden = thread !== null && isStaffOnlyKind(thread.kind) && !staff

  const canPost = detail?.canPost ?? false
  // 返信が「行として」在るか。**削除済み・非表示も数える**（D-BOARD-DELETE）。
  // 生きている返信の数（`replyCount`）で判定すると、運営が返信を伏せた瞬間に
  // 「丸ごと削除」へ倒れ、他人の投稿にまで削除の印が付く。
  const hasAnyReply = posts.some((post) => post.seq > 1)
  // 👍 を押せない理由（空文字なら押せる）。押してから弾かれるのでなく、押す前に見せる。
  const likeBlocked = thread ? likeBlockedReason(thread, me?.banned ?? false) : ''

  const anchorOf = (seq: number) => `${anchorPrefix}-post-${seq}`

  /** `>>N` を押したときの移動。無い番号（削除で行が飛んだ等）なら何もしない。 */
  const jumpTo = (seq: number) => {
    const el = document.getElementById(anchorOf(seq))
    if (!el) return
    // happy-dom には scrollIntoView が無いことがある。読み上げとキーボードのために
    // フォーカスだけは必ず移す（飛んだ先を見失わせない）。
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
    el.focus()
  }

  /** 返信先を決めて入力欄へ。番号を打ち直させない。 */
  const replyToSeq = (seq: number) => {
    setReplyTo(seq)
    setFormError('')
    replyRef.current?.focus()
  }

  /**
   * 書き込み系の失敗に共通の後始末。**次の一手がある失敗だけ画面の状態を動かす**
   * （未ログインならサインイン、表示名が未設定ならダイアログ）。それ以外は文言を出すだけ。
   */
  const handleFailure = (code: string, message: string, into: 'form' | 'toast') => {
    if (code === 'unauthorized') {
      auth.openSignIn()
      return
    }
    if (code === 'profile_required') {
      setNameOpen(true)
      return
    }
    if (into === 'form') setFormError(message)
    else toast.show(message)
    // 状態が変わったせいで断られた失敗は、**画面のほうを現実に合わせ直す**。
    // 投稿禁止・ロック・削除済みは開いている間に起きうるので、放っておくと
    // 「書けるはずのフォーム」が出たまま送るたびに弾かれる。
    if (code === 'banned' || code === 'locked' || code === 'gone') {
      void load()
      void loadMe()
    }
  }

  const submitReply = async () => {
    const body = replyBody.trim()
    if (sending || body === '') return
    setSending(true)
    setFormError('')
    const res = await createPost(threadId, { body, replyTo }, getToken)
    setSending(false)
    if (!res.ok) {
      handleFailure(res.code, res.message, 'form')
      return
    }
    // 送れたら入力を空にする。**失敗のときは消さない**（4000 字が通信の失敗で消えるのが
    // この画面でいちばん高くつく事故）。
    // 書いた返信は一覧のいちばん下＝入力欄のすぐ上に出るので、送ったあとに動かさない。
    setReplyBody('')
    setReplyTo(0)
    await load()
  }

  const removeThread = async () => {
    if (busy) return
    setBusy(true)
    const res = await deleteThread(threadId, getToken)
    setBusy(false)
    if (!res.ok) {
      handleFailure(res.code, res.message, 'toast')
      return
    }
    if (res.data.mode === 'whole') {
      toast.show('スレッドを削除しました')
      onBack()
      return
    }
    // 本文だけ消えた（返信が残っている）。消えた範囲を言い切る（D-BOARD-DELETE）。
    toast.show('本文を削除しました。返信は残ります')
    await load()
  }

  const removePost = async (post: BoardPost) => {
    if (busy) return
    setBusy(true)
    const res = await deletePost(post.id, getToken)
    setBusy(false)
    if (!res.ok) {
      handleFailure(res.code, res.message, 'toast')
      return
    }
    toast.show('書き込みを削除しました')
    await load()
  }

  /**
   * 書き込み 1 件への 👍。スレ全体ではなく**押した投稿だけ**を描き直す
   *（スレを読み直すと、読んでいた位置と入力途中の返信が飛ぶ）。
   */
  const like = async (post: BoardPost) => {
    if (busy || !thread) return
    setBusy(true)
    const res = await toggleLike(post.id, getToken)
    setBusy(false)
    if (!res.ok) {
      handleFailure(res.code, res.message, 'toast')
      return
    }
    // 押した結果はサーバが返す（どちらにするかは送っていない）。返ってきた値で描き直す。
    const { liked, likeCount } = res.data
    setDetail((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            posts: prev.posts.map((p) => (p.id === post.id ? { ...p, liked, likeCount } : p)),
            // 一覧に出る賛同数はスレ本文（seq=1）の 👍（0009）。押した先が本文なら揃える。
            thread: post.seq === 1 ? { ...prev.thread, liked, likeCount } : prev.thread,
          },
    )
  }

  const castVote = async (choices: number[]) => {
    const res = await vote(threadId, choices, getToken)
    if (!res.ok) {
      handleFailure(res.code, res.message, 'toast')
      return
    }
    // 投票が通ると票数入りの結果が返る＝スレを読み直さずに開示へ切り替えられる。
    setDetail((prev) => (prev ? { ...prev, poll: res.data.poll } : prev))
  }

  const sendReport = async (input: ReportInput) => await report(input, getToken)

  const submitName = async (name: string) => {
    const res = await setDisplayName(name, getToken)
    if (res.ok) {
      setMe(res.data.me)
      // 表示名が決まると `canPost` が変わる。読み直して返信フォームを出す。
      await load()
    }
    return res
  }

  const applyPatch = async (patch: ThreadPatchInput) => {
    const res = await patchThread(threadId, patch, getToken)
    if (!res.ok) {
      toast.show(res.message)
      return
    }
    setDetail((prev) => (prev ? { ...prev, thread: res.data.thread } : prev))
    toast.show('反映しました')
  }

  const applyModerate = async (input: ModerateInput) => {
    const res = await moderate(input, getToken)
    if (!res.ok) {
      toast.show(res.message)
      return
    }
    toast.show('措置を反映しました')
    await load()
  }

  return (
    <AppShell
      onBrandClick={onNavigateCollection}
      sidebar={
        <SideNav
          active={navActive}
          onNavigateCollection={onNavigateCollection}
          onNavigateActivity={onNavigateActivity}
          onNavigateIdeas={onNavigateIdeas}
          onNavigateBoard={onNavigateBoard}
          onNavigateSettings={onNavigateSettings}
          onNavigateHelp={onNavigateHelp}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-9">
        <div className="mx-auto w-full max-w-3xl pb-20">
          <button
            type="button"
            onClick={onBack}
            className="mb-4 flex items-center gap-1.5 rounded-md px-1 py-1 text-on-surface-variant text-sm transition-colors hover:text-on-surface"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            掲示板
          </button>

          {loading && (
            <p className="py-16 text-center text-on-surface-variant text-sm">読み込み中…</p>
          )}

          {!loading && loadError !== '' && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-on-surface-variant text-sm">{loadError}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                読み込み直す
              </Button>
            </div>
          )}

          {thread && detail && (
            <>
              <header className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {thread.pinned && (
                    <span className="inline-flex items-center gap-1 text-primary text-xs">
                      <Pin className="size-3.5" aria-hidden="true" />
                      先頭に固定
                    </span>
                  )}
                  <Badge className={KIND_UI[thread.kind].className}>
                    {KIND_UI[thread.kind].label}
                  </Badge>
                  {/* 運営ステータスは要望・不具合だけ（D-BOARD-KIND）。未設定はラベルが空。 */}
                  {hasStatusUi(thread.kind) && STATUS_UI[thread.status].label !== '' && (
                    <Badge className={STATUS_UI[thread.status].className}>
                      {STATUS_UI[thread.status].label}
                      {thread.status === 'shipped' && thread.shippedVersion !== '' && (
                        <span className="font-normal"> {thread.shippedVersion}</span>
                      )}
                    </Badge>
                  )}
                  {thread.locked && (
                    <span className="inline-flex items-center gap-1 text-on-surface-variant text-xs">
                      <Lock className="size-3.5" aria-hidden="true" />
                      書き込み終了
                    </span>
                  )}
                </div>

                <h1 className="font-semibold font-serif text-[22px] text-on-surface leading-8 [overflow-wrap:anywhere]">
                  {thread.title}
                </h1>

                {/* 運営が添えた一言。「言えば直る」が見える器の中身そのもの（D-BOARD-STATUS）。 */}
                {hasStatusUi(thread.kind) && thread.statusNote !== '' && (
                  <p className="rounded-lg bg-surface-container-low px-3 py-2 text-on-surface text-sm leading-6">
                    {thread.statusNote}
                  </p>
                )}

                {/* 賛同（👍）はスレッドの見出しには置かない。押したいのは「このスレッド」
                    ではなく中の 1 つの書き込みで、見出しに 1 つだけ置くと、どの意見に
                    票が入ったのか誰にも分からない。ボタンは投稿カードの中にある。 */}
              </header>

              {detail.poll && (
                <div className="mt-4">
                  <PollCard
                    poll={detail.poll}
                    onVote={castVote}
                    // 投票できるのはログイン済みで、書き込みを止められていない人だけ。
                    disabled={!auth.isSignedIn || (me?.banned ?? false)}
                  />
                </div>
              )}

              <StaffControls
                staff={staff}
                thread={thread}
                onPatch={applyPatch}
                onModerate={applyModerate}
                className="mt-4"
              />

              <ol className="mt-4 flex flex-col gap-2.5">
                {posts.map((post) => (
                  <li key={post.id}>
                    <PostCard
                      post={post}
                      anchorId={anchorOf(post.seq)}
                      now={now}
                      staff={staff}
                      canPost={canPost}
                      signedIn={auth.isSignedIn}
                      busy={busy}
                      likeBlocked={likeBlocked}
                      onLike={() => void like(post)}
                      onJump={jumpTo}
                      onReply={replyToSeq}
                      onDelete={() => {
                        // スレ本文（seq=1）は投稿の削除では消せない（`use_thread_delete`）。
                        // 消える範囲が違うので、確認ダイアログも別にする。
                        if (post.seq === 1) setConfirmThread(true)
                        else setConfirmPost(post)
                      }}
                      onReport={() => setReportTarget(post.id)}
                      onModerate={applyModerate}
                    />
                  </li>
                ))}
              </ol>

              {/* お知らせは運営からの連絡で、返信の器を持たない（D-BOARD-NOTICE）。
                  読む人には「書き込めません」の断りすら出さない——押せないボタンや
                  断り書きが並ぶより、最初から無いほうが読みやすい。運営には出す（追記できる）。 */}
              <section className={cn('mt-6', replySectionHidden && 'hidden')}>
                {canPost ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void submitReply()
                    }}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor={replyFieldId}>返信を書く</Label>
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          replyBody.length > BOARD_LIMITS.body
                            ? 'text-error'
                            : 'text-on-surface-variant/70',
                        )}
                      >
                        {replyBody.length} / {BOARD_LIMITS.body}
                      </span>
                    </div>

                    {/* サーバの `canPost` は表示名の有無を見ない（未登録でも true）。
                        送信時に 409 `profile_required` で返るので、先に一言だけ添えておく。 */}
                    {auth.isSignedIn && me?.profile == null && (
                      <p className="text-on-surface-variant text-xs">
                        はじめての書き込みでは、先に表示名を決めます。
                      </p>
                    )}

                    {replyTo > 0 && (
                      <p className="flex items-center gap-2 text-on-surface-variant text-xs">
                        <span>{replyLabel(replyTo)} への返信</span>
                        <button
                          type="button"
                          onClick={() => setReplyTo(0)}
                          className="underline underline-offset-2"
                        >
                          やめる
                        </button>
                      </p>
                    )}

                    <Textarea
                      id={replyFieldId}
                      ref={replyRef}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      maxLength={BOARD_LIMITS.body}
                      rows={5}
                      disabled={sending}
                      placeholder="思ったことを、ひとことからどうぞ"
                    />

                    {formError !== '' && (
                      <p role="alert" className="text-error text-sm">
                        {formError}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-on-surface-variant text-xs">
                        一行あけると、そこで段落が変わります
                      </span>
                      <Button type="submit" disabled={sending || replyBody.trim() === ''}>
                        {sending ? '送信中…' : '書き込む'}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <PostBlockedNotice
                    signedIn={auth.isSignedIn}
                    banned={me?.banned ?? false}
                    bannedUntil={me?.profile?.bannedUntil ?? 0}
                    deleted={thread.deleted}
                    locked={thread.locked}
                    onSignIn={auth.openSignIn}
                    onBack={onBack}
                    onNavigateHelp={onNavigateHelp}
                  />
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <NameDialog open={nameOpen} onOpenChange={setNameOpen} onSubmit={submitName} />

      <ReportDialog
        open={reportTarget !== ''}
        onOpenChange={(open) => {
          if (!open) setReportTarget('')
        }}
        postId={reportTarget}
        onSubmit={sendReport}
      />

      {/* スレの削除。**消える範囲を押す前に言う**（D-BOARD-DELETE）。返信があれば本文だけが
          消え、返信は残る＝スレ主の削除で他人の発言を巻き添えにしない。 */}
      <ConfirmDialog
        open={confirmThread}
        onOpenChange={setConfirmThread}
        title="このスレッドを削除しますか？"
        description={
          hasAnyReply
            ? '本文だけが消え、返信は残ります。この操作は取り消せません。'
            : 'スレッドごと消えます。この操作は取り消せません。'
        }
        confirmLabel="削除"
        onConfirm={() => void removeThread()}
      />

      <ConfirmDialog
        open={confirmPost !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPost(null)
        }}
        title="この書き込みを削除しますか？"
        description="本文が「この投稿は削除されました」に変わります。この操作は取り消せません。"
        confirmLabel="削除"
        onConfirm={() => {
          const target = confirmPost
          if (target) void removePost(target)
        }}
      />
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// 投稿 1 件
// ---------------------------------------------------------------------------

interface PostCardProps {
  post: BoardPost
  /** `>>N` の飛び先になる id */
  anchorId: string
  now: number
  staff: boolean
  /** このスレに書けるか（返信ボタンを出すかの判断） */
  canPost: boolean
  signedIn: boolean
  busy: boolean
  /** 👍 を押せない理由（押せるなら空文字）。スレの状態から決まるので上から降ってくる */
  likeBlocked: string
  onLike: () => void
  onJump: (seq: number) => void
  onReply: (seq: number) => void
  onDelete: () => void
  onReport: () => void
  onModerate: (input: ModerateInput) => Promise<void>
}

/**
 * 投稿 1 件。`seq === 1` がスレ本文（設計 §4）で、以降が返信。
 *
 * 本文は必ず `BoardBody` に通す＝削除・非表示なら伏字だけが出る。ここで `post.body` を
 * 直に描く経路を作らない。
 */
function PostCard({
  post,
  anchorId,
  now,
  staff,
  canPost,
  signedIn,
  busy,
  likeBlocked,
  onLike,
  onJump,
  onReply,
  onDelete,
  onReport,
  onModerate,
}: PostCardProps) {
  const likeReasonId = useId()
  const masked = post.deleted || post.hidden
  const time = formatBoardTime(post.createdAt, now)
  const head = post.seq === 1
  // 押せない理由は 1 枚めのカードにだけ出す（同じ文が投稿の数だけ並ぶと読み飛ばされる）。
  // **`aria-describedby` は出している時だけ**指す。描いていない id を指すと、読み上げが
  // 空の説明を拾って「賛同」以外なにも読まれないボタンになる。
  const showLikeReason = likeBlocked !== '' && head

  return (
    // `tabIndex={-1}` は `>>N` で飛んできたときのフォーカス先。読み上げでも位置が分かる。
    <article
      id={anchorId}
      tabIndex={-1}
      className={cn(
        'rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-3.5',
        head && 'border-outline-variant/60',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-on-surface-variant text-xs">
        <span className="tabular-nums">{post.seq}</span>
        {/* 退会した人の投稿は残り、表示名だけが伏せられる（D-BOARD-ACCOUNTDEL）。
            伏せ名だと分かるように、生きている表示名とは色を変える。 */}
        <span
          className={cn(
            'truncate',
            post.author.retired ? 'text-on-surface-variant/70' : 'font-medium text-on-surface',
          )}
        >
          {post.author.displayName}
        </span>
        {post.author.staff && <Badge className="bg-primary text-primary-foreground">運営</Badge>}
        {time !== '' && <span>{time}</span>}
        {post.replyTo > 0 && (
          <button
            type="button"
            onClick={() => onJump(post.replyTo)}
            className="rounded text-forest-700 underline underline-offset-2"
          >
            {replyLabel(post.replyTo)}
          </button>
        )}
      </div>

      <BoardBody body={post.body} deleted={post.deleted} hidden={post.hidden} className="mt-2" />

      {/* リンクカードは伏字の投稿には出さない（本文が消えているのに引用だけ残らないように）。 */}
      {!masked && post.links.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {post.links.map((card) => (
            <BoardLinkCard key={card.url} card={card} />
          ))}
        </div>
      )}

      {!masked && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* 賛同（👍）。**書き込み 1 件ごとに小さく置く**（0009）。未ログインでも出す
              ＝押すと 401 を受けてログインのダイアログが開く（押せなくすると導線が消える）。
              数は 0 のとき出さない。「賛同 0」は、まだ誰も押していないことより
              「誰にも賛同されていない」と読めてしまう。 */}
          <button
            type="button"
            onClick={onLike}
            disabled={busy || likeBlocked !== ''}
            aria-pressed={post.liked}
            aria-describedby={showLikeReason ? likeReasonId : undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded text-xs disabled:opacity-50',
              post.liked
                ? 'font-medium text-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            <ThumbsUp className="size-3.5" aria-hidden="true" />
            賛同
            {post.likeCount > 0 && (
              <span className="tabular-nums">{formatCount(post.likeCount)}</span>
            )}
          </button>
          {/* **ボタンは消さずに理由を添える。** 消すと、賛同の数（締めた時点の根拠）まで
              画面から無くなり、押せなくなったことにも気づけない。 */}
          {showLikeReason && (
            <span id={likeReasonId} className="text-on-surface-variant text-xs">
              {likeBlocked}
            </span>
          )}
          {canPost && (
            <button
              type="button"
              onClick={() => onReply(post.seq)}
              className="inline-flex items-center gap-1 rounded text-on-surface-variant text-xs hover:text-on-surface"
            >
              <CornerDownRight className="size-3.5" aria-hidden="true" />
              返信
            </button>
          )}
          {post.mine ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded text-error text-xs disabled:opacity-50"
            >
              削除
            </button>
          ) : (
            // 通報はログイン必須（`POST /api/board/reports`）。押してから 401 を出すより、
            // 出さないほうが正直。
            signedIn && (
              <button
                type="button"
                onClick={onReport}
                className="rounded text-on-surface-variant text-xs hover:text-on-surface"
              >
                通報
              </button>
            )
          )}
        </div>
      )}

      <StaffPostControls
        staff={staff}
        post={post}
        onModerate={onModerate}
        now={now}
        className="mt-2"
      />
    </article>
  )
}

// ---------------------------------------------------------------------------
// 書けないときの案内
// ---------------------------------------------------------------------------

interface PostBlockedNoticeProps {
  signedIn: boolean
  banned: boolean
  bannedUntil: number
  /** スレが削除済みか（本文だけ消えた head-only もここに来る） */
  deleted: boolean
  locked: boolean
  onSignIn: () => void
  /** 掲示板の一覧へ戻る */
  onBack: () => void
  /** ヘルプ（お問い合わせフォームの置き場）へ。渡されないときは文言だけ出す */
  onNavigateHelp?: () => void
}

/**
 * `canPost` が false のとき、返信フォームの代わりに出す案内。
 *
 * **理由の並びは `canPost`（`src/core/board/permission.ts`）に揃える**
 * ＝未ログイン → 投稿禁止 → ロック。揃えておくと、案内に従って直したのに書けない、
 * という食い違いが起きない。ロック中でも staff は書けるので、そのときはサーバの
 * `canPost` が true で返り、ここは描かれない。
 *
 * **表示名の未設定はここに出さない。** サーバの `canPost` はプロフィールの有無を見ない
 *（未登録でも true）ので、ここで「表示名を決めてください」と言うと、実際の理由
 *（ロック等）を覆い隠す。表示名は送信時の 409 `profile_required` で拾い、
 * その場でダイアログを出す（設計 §2 の「初回投稿の直前に挟む」）。
 */
function PostBlockedNotice({
  signedIn,
  banned,
  bannedUntil,
  deleted,
  locked,
  onSignIn,
  onBack,
  onNavigateHelp,
}: PostBlockedNoticeProps) {
  if (!signedIn) {
    return (
      <Notice text={boardErrorMessage('unauthorized')}>
        <Button type="button" size="sm" onClick={onSignIn}>
          ログイン
        </Button>
      </Notice>
    )
  }

  if (banned) {
    const until = formatBanUntil(bannedUntil)
    return (
      // 期限を出すときも**問い合わせ先を落とさない**（`boardErrorMessage('banned')` は
      // 1 文にまとめて持っている）。身に覚えのない人にとっては、期限より先に要る情報。
      <Notice
        text={
          until === ''
            ? '運営の判断で、いまは書き込みを止めています。'
            : `運営の判断で、いまは書き込みを止めています。${until} まで書き込めません。`
        }
        sub="心当たりがなければ、ヘルプからお問い合わせください。"
      >
        {onNavigateHelp && (
          <Button type="button" size="sm" variant="outline" onClick={onNavigateHelp}>
            ヘルプを開く
          </Button>
        )}
      </Notice>
    )
  }

  // 削除済み。**何が起きたのかと、次の行き先を両方書く**（「書き込めません」だけだと、
  // 自分が弾かれたのかスレが消えたのかが読み手には分からない）。
  if (deleted) {
    return (
      <Notice text="このスレッドは削除されました。ほかのスレッドは一覧から開けます。">
        <Button type="button" size="sm" variant="outline" onClick={onBack}>
          一覧へ戻る
        </Button>
      </Notice>
    )
  }

  if (locked) return <Notice text="このスレッドは書き込みを終了しています。" />

  return <Notice text="このスレッドには書き込めません。" />
}

function Notice({ text, sub, children }: { text: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
      <div className="min-w-0">
        <p className="text-on-surface-variant text-sm leading-6">{text}</p>
        {sub !== undefined && sub !== '' && (
          <p className="mt-0.5 text-on-surface-variant/80 text-xs leading-5">{sub}</p>
        )}
      </div>
      {children}
    </div>
  )
}
