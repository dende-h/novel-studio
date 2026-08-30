import { Lock, MessageSquare, Pin, ThumbsUp, Vote } from 'lucide-react'
import type { BoardKind, BoardThread } from '@/core/board/types'
import { hasStatusUi } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { formatCount } from '@/ui/_utils/format'
import { formatBoardTime, KIND_UI, kindOrder, STATUS_UI } from '@/ui/board/board-ui'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'

/**
 * 掲示板の一覧（設計 09-board §2）。**表示だけ**を担う部品で、
 * 取得・絞り込みの状態・スレ立ての導線は画面本体（`board-page.tsx`）が持つ。
 *
 * 置いている決めごとは 4 つ。
 * 1. 色は `@/ui/board/board-ui` の `KIND_UI` / `STATUS_UI` からしか取らない。
 *    ここで色を決めると、同じスレが一覧と詳細で違う色になる。
 * 2. **👍 と運営ステータスは要望・不具合だけ**（`hasStatusUi`）。統合前の目安箱
 *    （`suggestion`）もこの仲間で、運営が付けたステータスと 👍 は残したまま出す。
 *    雑談スレに「受付」と 0 件の 👍 が並ぶと、器の意味が薄れる。
 * 3. **お知らせ（`notice`）は行ごと目立たせる**。チップだけだと、流し読みしている目には
 *    ほかの 1 行と同じ重さで通り過ぎる。強調の仕方は `KIND_UI[kind].rowClassName`。
 * 4. 行は `<a>`。div に onClick を付けると Tab で辿れず、中クリックでも開けない。
 */

/** スレ詳細のハッシュ。一覧と画面本体で同じ形を使うため export する。 */
export const threadHref = (id: string): string => `#/board/${encodeURIComponent(id)}`

// ---------------------------------------------------------------------------
// 1 行
// ---------------------------------------------------------------------------

export interface ThreadRowProps {
  thread: BoardThread
  /** 相対時刻の基準。テストから固定できるように受け取る */
  now?: number
  /** 飛び先。省略時は `threadHref` */
  href?: string
}

/**
 * スレッド 1 行。タイトル・種別・運営ステータス・投稿者・最終書き込み・返信数・👍・抜粋を出す。
 *
 * 行ぜんぶを 1 つのリンクにしてある。行の中にボタン（👍 のトグル等）を混ぜると
 * リンクの入れ子になり、キーボードの移動順が読めなくなる。押せる 👍 はスレ詳細に置く。
 */
export function ThreadRow({ thread, now = Date.now(), href }: ThreadRowProps) {
  const kindUi = KIND_UI[thread.kind]
  const withStatus = hasStatusUi(thread.kind)
  const statusUi = STATUS_UI[thread.status]
  // ステータスチップは「種別が対象」かつ「付いている」ときだけ。未設定は label が空。
  const showStatus = withStatus && statusUi.label !== ''
  const bumped = formatBoardTime(thread.bumpedAt, now)
  const author = thread.author.displayName

  return (
    <a
      href={href ?? threadHref(thread.id)}
      className={cn(
        'block border-outline-variant/25 border-b px-3 py-2.5',
        'no-underline transition-colors hover:bg-surface-container-low',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        // 目立たせる種別（お知らせ）だけ、枠と下地を上書きする。どの種別をどう出すかは
        // `KIND_UI` が決める＝ここで色を選ばない（種別ごとの分岐を画面に持ち込まない）。
        kindUi.rowClassName,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {thread.pinned && (
          <span className="inline-flex items-center gap-1 text-primary text-xs">
            <Pin className="size-3.5" aria-hidden="true" />
            <span className="sr-only">先頭に固定</span>
          </span>
        )}
        <Badge className={kindUi.className}>{kindUi.label}</Badge>
        {showStatus && (
          <Badge className={statusUi.className}>
            {statusUi.label}
            {/* 実装済みのリリース版はステータスに添える（掲示板が変更履歴になる・D-BOARD-STATUS） */}
            {thread.status === 'shipped' && thread.shippedVersion !== '' && (
              <span className="font-normal"> {thread.shippedVersion}</span>
            )}
          </Badge>
        )}
        {thread.hasPoll && (
          <Badge className="bg-surface-container-high text-on-surface-variant">
            <Vote className="size-3" aria-hidden="true" />
            アンケート
          </Badge>
        )}
        {thread.locked && (
          <span className="inline-flex items-center gap-1 text-on-surface-variant text-xs">
            <Lock className="size-3.5" aria-hidden="true" />
            書き込み終了
          </span>
        )}
      </div>

      {/* 本文の抜粋は出さない。1 行あたりの高さが倍になり、一覧で見渡せる本数が半分以下になる。
          何が書いてあるかはタイトルで見当をつけ、開いて読む。抜粋そのものは API が返し続ける
          （`BoardThread.excerpt`）ので、必要になったら戻せる。 */}
      <h3 className="mt-1 truncate font-semibold text-[15px] text-on-surface leading-6">
        {thread.title}
      </h3>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-on-surface-variant text-xs">
        <span className="truncate">{author}</span>
        {thread.author.staff && <Badge className="bg-primary text-primary-foreground">運営</Badge>}
        {bumped !== '' && <span>{bumped}</span>}
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          <span className="sr-only">返信</span>
          {formatCount(thread.replyCount)}
        </span>
        {/* 👍 は要望・不具合だけ（D-BOARD-KIND）。雑談に票を出しても意味がない */}
        {withStatus && (
          <span className="inline-flex items-center gap-1">
            <ThumbsUp
              className={cn('size-3.5', thread.liked && 'text-primary')}
              aria-hidden="true"
            />
            <span className="sr-only">賛同</span>
            {formatCount(thread.likeCount)}
          </span>
        )}
      </div>
    </a>
  )
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

export interface ThreadListProps {
  threads: readonly BoardThread[]
  now?: number
  /** いま絞り込んでいる種別（空状態の文言が変わる）。null は「すべて」 */
  kind?: BoardKind | null
  /** 飛び先の作り方を差し替えたいとき */
  hrefOf?: (thread: BoardThread) => string
  /** スレ立ての導線。渡さなければボタンを出さない（未ログイン時など） */
  onCreate?: () => void
  /** 絞り込みを解除する導線。種別で絞ってゼロ件のときだけ使う */
  onClearKind?: () => void
  className?: string
}

/**
 * スレッドの並び。**ピン留めを先頭へ寄せる**（設計 §2）。
 *
 * 並べ替えはサーバがしているが、ここでも安定ソートで前に出す。同じ規則を 2 か所で持つのは
 * 冗長に見えて、絞り込みや追加読み込みで配列を継ぎ足したときにピン留めが埋もれないため。
 * ピン留め同士・通常同士の順番（＝サーバの最終書き込み順）は崩さない。
 */
export function ThreadList({
  threads,
  now = Date.now(),
  kind = null,
  hrefOf,
  onCreate,
  onClearKind,
  className,
}: ThreadListProps) {
  const pinned = threads.filter((t) => t.pinned)
  const rest = threads.filter((t) => !t.pinned)
  const ordered = [...pinned, ...rest]

  if (ordered.length === 0) {
    return <ThreadListEmpty kind={kind} onCreate={onCreate} onClearKind={onClearKind} />
  }

  return (
    // 隙間を空けたカードでなく、罫線で区切った 1 枚のリストにする。
    // 掲示板は「どれを開くか」を選ぶ画面なので、1 画面に入る本数がそのまま使い勝手になる。
    <ul
      className={cn(
        'overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest',
        '[&>li:last-child>a]:border-b-0',
        className,
      )}
    >
      {ordered.map((thread) => (
        <li key={thread.id}>
          <ThreadRow thread={thread} now={now} href={hrefOf?.(thread)} />
        </li>
      ))}
    </ul>
  )
}

/**
 * 空のときの案内（設計 §2 の過疎対策）。
 *
 * 「まだありません」で終わらせず、**次の一手**を出す。掲示板は最初の 1 本が出るまでが
 * いちばん静かで、そこで引き返されると器そのものが立ち上がらない。
 */
function ThreadListEmpty({
  kind,
  onCreate,
  onClearKind,
}: Pick<ThreadListProps, 'kind' | 'onCreate' | 'onClearKind'>) {
  // 絞り込んでいるかは「種別の名前が引けたか」で見る（null と undefined を別に扱わない）。
  const kindLabel = kind ? KIND_UI[kind].label : ''
  const filtered = kindLabel !== ''

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <MessageSquare className="size-8 text-on-surface-variant/40" aria-hidden="true" />
      <p className="text-on-surface-variant text-sm">
        {filtered
          ? `${kindLabel}のスレッドは、まだ 1 本もありません。`
          : 'うまく動かないところも、あったらいいなと思う機能も、ひとことから書けます。'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onCreate && (
          <Button type="button" size="sm" onClick={onCreate}>
            スレッドを立てる
          </Button>
        )}
        {filtered && onClearKind && (
          <Button type="button" size="sm" variant="outline" onClick={onClearKind}>
            すべての種別を見る
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 種別フィルタ
// ---------------------------------------------------------------------------

export interface KindFilterProps {
  /** null は「すべて」 */
  kind: BoardKind | null
  onChange: (kind: BoardKind | null) => void
  className?: string
}

/**
 * 種別の絞り込み。並びは `kindOrder`（お知らせ・要望・不具合・雑談・自己紹介・作品紹介）に従う。
 * **廃止した「目安箱」は出さない**（`kindOrder` が落としている）。出すと「要望」のタブが
 * 2 つ並び、押すたびに別の一覧が出る画面になる。旧目安箱のスレは要望のタブに合流する
 *（どの種別を引くかはサーバの一覧 API が `kindsForFilter` で決める）。
 *
 * `aria-pressed` のトグルボタンにしてある。タブ（role="tablist"）にすると
 * 「押した瞬間に対応するパネルが現れる」約束になるが、実際は同じ一覧が絞られるだけ。
 */
export function KindFilter({ kind, onChange, className }: KindFilterProps) {
  return (
    // 見出しは読み上げにだけ残す（画面では絞り込みの列だと見れば分かる）。
    <fieldset className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      <legend className="sr-only">種別で絞り込む</legend>
      <FilterChip label="すべて" active={kind === null} onClick={() => onChange(null)} />
      {kindOrder.map((k) => (
        <FilterChip
          key={k}
          label={KIND_UI[k].label}
          active={kind === k}
          // もう一度押したら解除する（絞り込みを外すのに「すべて」まで目を戻さなくてよい）
          onClick={() => onChange(kind === k ? null : k)}
        />
      ))}
    </fieldset>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low',
      )}
    >
      {label}
    </button>
  )
}
