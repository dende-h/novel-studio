import { isStaffOnlyKind } from '@/core/board/permission'
import { boardBodyToPlain } from '@/core/board/render'
import {
  BOARD_KINDS,
  BOARD_LIMITS,
  type BoardKind,
  type BoardRole,
  type BoardStatus,
  boardKindLabel,
  boardStatusLabel,
  CREATABLE_KINDS,
  canonicalKind,
} from '@/core/board/types'
import { formatRelative } from '@/ui/_utils/format'

/**
 * 掲示板の見せ方（一覧・スレ詳細・「自分の書き込み」タブの共有部分）。
 * 種別チップの色・ステータスチップの色・相対時刻・抜粋・未読の基準を 1 か所に置く＝
 * 同じスレが画面ごとに違う色、違う長さの抜粋で出ることを防ぐ。
 *
 * `src/ui/plot/beat-ui.ts` と同じ位置づけで、**React に依存しない純粋な表示ヘルパだけ**を置く。
 * ラベルは `@/core/board/types` の表（`boardKindLabel` / `boardStatusLabel`）をそのまま使い、
 * ここで決めるのは色と並び順だけ。文言の正本を 2 つに割らない。
 */

// ---------------------------------------------------------------------------
// 種別
// ---------------------------------------------------------------------------

/** 種別チップ 1 つぶんの見た目。 */
export type BoardKindUi = {
  /** 表記（`boardKindLabel` の写し） */
  label: string
  /** チップの Tailwind クラス（背景＋文字色） */
  className: string
  /** 一覧の絞り込みタブでの並び（小さいほど左） */
  order: number
  /**
   * 一覧の行そのものを目立たせるクラス（既定の枠と背景に重ねる）。
   * 目立たせない種別は空文字＝行の見た目は今までどおり。
   */
  rowClassName: string
}

/**
 * 種別ごとの見た目（D-BOARD-KIND）。
 *
 * 色は 3 群に分けている。**お知らせ（運営からの連絡）だけ塗りつぶし**で、
 * **運営に届ける 2 種（要望・不具合）は色で見分けられる**ように麦・赤の淡色を当て、
 * **交流の 3 種（雑談・自己紹介・作品紹介）は一段控えめ**にする。
 * 全部を強い色にすると、一覧がチップの色見本になって肝心のタイトルが読めなくなる。
 *
 * 塗りつぶしは掲示板全体で 2 つだけ（お知らせのチップと、実装済みのステータス）。
 * 増やすほど 1 つあたりの効きが薄れる。
 *
 * 旧 `suggestion`（目安箱）は `request` と**同じ見た目・同じラベル**にする。
 * 統合したのに一覧で 2 種類の見た目が並ぶと、統合していないのと変わらない。
 *
 * 使うトークンはすべてライト／ダークで反転が定義済みのもの（`src/ui/index.css`）に限る。
 * 生の 16 進色を書くと片方のテーマで沈む。
 */
const REQUEST_CHIP = 'bg-secondary-container text-on-secondary-container'

export const KIND_UI: Record<BoardKind, BoardKindUi> = {
  notice: {
    label: boardKindLabel.notice,
    className: 'bg-primary text-primary-foreground',
    order: 0,
    // 運営からの連絡は、一覧を流し読みしていても目に留まる必要がある。
    // 枠と下地だけ変え、文字色は行のまま（読みやすさを塗りで殺さない）。
    rowClassName: 'border-primary/40 bg-primary-container/30',
  },
  suggestion: {
    label: boardKindLabel.suggestion,
    className: REQUEST_CHIP,
    order: 1,
    rowClassName: '',
  },
  request: {
    label: boardKindLabel.request,
    className: REQUEST_CHIP,
    order: 1,
    rowClassName: '',
  },
  bug: {
    label: boardKindLabel.bug,
    className: 'bg-error-container text-on-error-container',
    order: 2,
    rowClassName: '',
  },
  chat: {
    label: boardKindLabel.chat,
    className: 'bg-surface-container-high text-on-surface-variant',
    order: 3,
    rowClassName: '',
  },
  intro: {
    label: boardKindLabel.intro,
    className: 'bg-forest-50 text-forest-600',
    order: 4,
    rowClassName: '',
  },
  promo: {
    label: boardKindLabel.promo,
    className: 'bg-surface-container text-secondary-foreground',
    order: 5,
    rowClassName: '',
  },
}

/**
 * 一覧の種別フィルタの並び（お知らせ・要望・不具合・雑談・自己紹介・作品紹介）。
 * `KIND_UI` の `order` から導出する＝表と並びが食い違うことがない。
 *
 * **廃止した種別（`suggestion`）はタブに出さない。** 出すと「要望」のタブが 2 つ並ぶ。
 * 既存の目安箱スレは「要望」のタブに合流させる（どの種別を引くかは
 * `kindsForFilter`・サーバの一覧 API が使う）。
 */
export const kindOrder: readonly BoardKind[] = BOARD_KINDS.filter(
  (kind) => canonicalKind(kind) === kind,
).sort((a, b) => KIND_UI[a].order - KIND_UI[b].order)

/**
 * スレを立てる画面に出す種別の並び。**立場で変わるのはお知らせだけ**
 *（member には選択肢そのものを出さない＝押してから 403 で断らない）。
 *
 * 判定は `@/core/board/permission` の表から引く。画面側で `role === 'staff'` と
 * 書くと、サーバの許可と画面の選択肢が別々に育つ。
 */
export const creatableKindOrder = (role: BoardRole): readonly BoardKind[] =>
  kindOrder.filter(
    (kind) => CREATABLE_KINDS.includes(kind) && (role === 'staff' || !isStaffOnlyKind(kind)),
  )

// ---------------------------------------------------------------------------
// 運営ステータス
// ---------------------------------------------------------------------------

/** ステータスチップ 1 つぶんの見た目。 */
export type BoardStatusUi = {
  /** 表記（`boardStatusLabel` の写し）。`''` は「まだ付けていない」＝チップを出さない */
  label: string
  /** チップの Tailwind クラス。ラベルが空のときは空文字 */
  className: string
  /** 目立たせる枠か（塗りつぶしで出す） */
  emphasis: boolean
}

/**
 * 運営ステータスごとの見た目（D-BOARD-STATUS）。
 *
 * **`shipped`（実装済み）だけを塗りつぶし**にする。掲示板は「言えば直る」が見える器で、
 * 実装済みの列が一覧で目に入ることだけが次の投稿を呼ぶ。ほかは淡色にして、
 * 受付 → 検討中 → 対応予定 と進むほど緑に近づける＝進捗が色の向きで読める。
 *
 * `''`（未設定）も表に持つ。ここを欠かすと、ステータスの付いていないスレで
 * 引き当てが `undefined` になり、チップどころかその行ごと描けなくなる。
 */
export const STATUS_UI: Record<BoardStatus, BoardStatusUi> = {
  '': { label: boardStatusLabel[''], className: '', emphasis: false },
  received: {
    label: boardStatusLabel.received,
    className: 'border border-outline-variant/50 text-on-surface-variant',
    emphasis: false,
  },
  reviewing: {
    label: boardStatusLabel.reviewing,
    className: 'bg-secondary-container text-on-secondary-container',
    emphasis: false,
  },
  planned: {
    label: boardStatusLabel.planned,
    className: 'bg-primary-container text-on-primary-container',
    emphasis: false,
  },
  shipped: {
    label: boardStatusLabel.shipped,
    className: 'bg-primary text-primary-foreground',
    emphasis: true,
  },
  declined: {
    label: boardStatusLabel.declined,
    className: 'bg-surface-container-highest text-on-surface-variant',
    emphasis: false,
  },
}

// ---------------------------------------------------------------------------
// 時刻
// ---------------------------------------------------------------------------

/**
 * 投稿時刻の表記。アプリ全体と同じ `formatRelative`（たった今 / N分前 / 月日 時:分）に寄せる。
 * 掲示板だけ別の言い回しにしない。
 *
 * 時刻が入っていない（0 や NaN）ときは空文字を返す＝1970 年が画面に出るより、
 * 何も出ないほうが害が小さい。
 */
export function formatBoardTime(ms: number, now: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return formatRelative(ms, now)
}

// ---------------------------------------------------------------------------
// 未読（設計 §2「未読の基準は localStorage に置く」）
// ---------------------------------------------------------------------------

/** 最後に掲示板を見た時刻を置く localStorage のキー。 */
export const BOARD_SEEN_KEY = 'ns-board-seen'

/**
 * 最後に見た時刻（epoch ms）。記録が無い・壊れている・localStorage が使えないときは 0。
 *
 * 0 は「一度も見ていない」＝全部が未読になるが、それでよい。既読側へ倒すと、
 * 初めて開いた人に付いた返信がバッジに出ないまま埋もれる。
 */
export function readLastSeen(): number {
  try {
    const raw = localStorage.getItem(BOARD_SEEN_KEY)
    if (!raw) return 0
    const at = Number(raw)
    return Number.isFinite(at) && at > 0 ? at : 0
  } catch {
    // プライベートウィンドウ等で localStorage 自体が投げる。未読の記録は諦めて 0 にする。
    return 0
  }
}

/**
 * 「ここまで見た」を記録する。D1 に既読テーブルを持たない代わりの、端末ローカルの印。
 *
 * 書けなくても黙って続ける（バッジが消えないだけで、投稿の読み書きには影響しない）。
 */
export function markSeen(now: number): void {
  if (!Number.isFinite(now) || now <= 0) return
  try {
    localStorage.setItem(BOARD_SEEN_KEY, String(Math.floor(now)))
  } catch {
    // 書き込み拒否。次に開いてもバッジが残るだけで実害はない。
  }
}

/** 未読を数える対象。`BoardPost` をそのまま渡せる形にしてある。 */
export type UnreadPost = {
  createdAt: number
  /** 自分の投稿か（サーバが付ける） */
  mine?: boolean
  deleted?: boolean
  hidden?: boolean
  author?: { displayName: string }
}

/**
 * 未読の数。**「自分が関わったスレの投稿」を渡す側で絞ってから**呼ぶ
 *（どの投稿が自分宛かの判断は、スレを持っている画面のほうが正しくできる）。
 *
 * 数える条件は 3 つ。
 * - `lastSeen` より**後**に書かれたもの。**同時刻はすでに読んだ扱い**にする
 *   （`markSeen(now)` の直後に同じ ms の投稿を数え直して、消えないバッジを作らない）。
 * - 自分の投稿でないもの。`mine` が来ない経路のために、表示名（`myUserKey`）でも落とす。
 * - 削除・非表示でないもの。伏字にバッジを立てても、開いた人には何も残っていない。
 */
export function unreadCount(
  posts: readonly UnreadPost[],
  lastSeen: number,
  myUserKey?: string,
): number {
  const since = Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : 0
  const mine = myUserKey?.trim() ?? ''
  let count = 0
  for (const post of posts) {
    if (!Number.isFinite(post.createdAt) || post.createdAt <= since) continue
    if (post.deleted || post.hidden) continue
    if (post.mine) continue
    if (mine !== '' && post.author?.displayName === mine) continue
    count += 1
  }
  return count
}

// ---------------------------------------------------------------------------
// 抜粋
// ---------------------------------------------------------------------------

/**
 * 一覧の 1 行に出す抜粋。記法の記号を落とし、改行を空白に畳んでから丸める。
 * 返すのは**テキスト**なので、埋める側は `textContent`（JSX の子）として扱う。
 *
 * 丸めはコードポイント単位で数える。`slice` だとサロゲートペア（絵文字・一部の漢字）を
 * 真ん中で割って壊れた文字が出る。
 */
export function excerptOf(text: string | undefined, max: number = BOARD_LIMITS.excerpt): string {
  const plain = boardBodyToPlain(text ?? '')
  if (max <= 0) return ''
  const chars = [...plain]
  if (chars.length <= max) return plain
  return `${chars.slice(0, max).join('')}…`
}
