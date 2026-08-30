/**
 * 掲示板の「誰が何をできるか」を 1 か所に集めた純ロジック。React・DOM・D1 に依存しない。
 *
 * 権限の判断は、放っておくと各エンドポイントと UI の両方に散る。散ると必ず片方だけ緩み、
 * 「他人の投稿が消せる」「ロックしたスレに書ける」という取り返しのつかない事故になる。
 * そこで判断そのものはすべてこのファイルへ寄せ、サーバは結果を HTTP に写すだけにする。
 *
 * 戻り値を真偽値にしないのが要点。真偽値だと「なぜ駄目か」が呼び出し側の想像になり、
 * 未ログイン（401）とロック済み（409）が同じ 403 に潰れる。判別可能な
 * `{ ok: true } | { ok: false, reason }` を返し、reason → HTTP ステータスの対応表
 * `STATUS_OF_REASON` も同じファイルで公開して、写し間違いが起きない形にしている。
 *
 * 時刻は必ず `now` を引数で受ける（`Date.now()` を内部で呼ばない）。投稿禁止の期限は
 * サーバの保存時刻でもテストの固定時刻でも同じ関数で判定できる必要があるため。
 *
 * 設計書: docs/requirement/09-board.md（D-BOARD-DELETE / §7-4・§7-5・§7-6）
 */

import {
  CREATABLE_KINDS as CONTRACT_CREATABLE_KINDS,
  KINDS_WITH_STATUS as CONTRACT_KINDS_WITH_STATUS,
  STAFF_ONLY_KINDS as CONTRACT_STAFF_ONLY_KINDS,
} from './types'

// ---------------------------------------------------------------------------
// 受け取る形（Zod の BoardThread / BoardPost の必要な部分だけを構造的に受ける）
// ---------------------------------------------------------------------------

/** 掲示板での立場。`staff` は運営。 */
export type BoardRole = 'member' | 'staff'

/** 判断の主体。未ログインは `userId === null`。 */
export type Actor = {
  /** ログイン中の Clerk ユーザ ID。未ログインなら null */
  userId: string | null
  /** 立場（既定は member） */
  role: BoardRole
  /** 投稿禁止の期限（epoch ms・0 = 禁止されていない） */
  bannedUntil: number
}

/**
 * 判断に要るぶんだけのスレ。Zod の `BoardThread` はこれを満たす。
 * `locked` は D1 から 0/1 で来ることがあるので数値も受ける。
 */
export type ThreadLike = {
  /** スレ主の user_id */
  userId: string
  /** 種別（`request` / `bug` などの文字列） */
  kind: string
  /** ロック中か（staff 以外は書けない） */
  locked: boolean | number
  /** 返信の件数（スレ本文は含まない） */
  replyCount: number
  /** 論理削除の時刻（0 = 生きている） */
  deletedAt: number
  /** 運営による非表示の時刻（0 = 表示中） */
  hiddenAt: number
}

/** 判断に要るぶんだけの投稿。Zod の `BoardPost` はこれを満たす。 */
export type PostLike = {
  /** 投稿者の user_id */
  userId: string
  /** 本文 */
  body: string
  /** 論理削除の時刻（0 = 生きている） */
  deletedAt: number
  /** 運営による非表示の時刻（0 = 表示中） */
  hiddenAt: number
}

// ---------------------------------------------------------------------------
// 結果の形
// ---------------------------------------------------------------------------

/** 断る理由。そのまま HTTP ステータスへ写せるように粒度を切っている。 */
export const PERMISSION_DENY_REASONS = [
  /** 未ログイン（401） */
  'unauthorized',
  /** ログインはしているが権限がない（403） */
  'forbidden',
  /** 投稿禁止中（403） */
  'banned',
  /** ロック中のスレ（409） */
  'locked',
  /** 削除済み・非表示で、もう触れない（404） */
  'gone',
  /**
   * その種別では使えない操作（400）。👍 と運営ステータスは要望・不具合だけ、
   * 廃止した種別（`suggestion`）でのスレ立てもここへ落ちる
   */
  'unsupported-kind',
] as const

export type PermissionDenyReason = (typeof PERMISSION_DENY_REASONS)[number]

/** 許可か、理由つきの拒否か。 */
export type PermissionResult = { ok: true } | { ok: false; reason: PermissionDenyReason }

/** 理由 → HTTP ステータス。サーバはこの表を引くだけにする。 */
export const STATUS_OF_REASON: Record<PermissionDenyReason, number> = {
  unauthorized: 401,
  forbidden: 403,
  banned: 403,
  locked: 409,
  gone: 404,
  'unsupported-kind': 400,
}

/**
 * 👍 と運営ステータスが付く種別（D-BOARD-KIND / D-BOARD-STATUS）。
 *
 * **表そのものは契約（`./types`）が正本。**ここは `ThreadLike.kind` が素の string
 * （D1 の行をそのまま受ける）なので、`readonly string[]` に広げて持ち替えるだけにする。
 * 書き写すと片方にだけ種別が増えて、「一覧には出るのにステータスが付けられない」
 * という食い違いが起きる。
 */
export const KINDS_WITH_STATUS: readonly string[] = CONTRACT_KINDS_WITH_STATUS

/** 運営（staff）だけが立てられる種別。同じ理由で契約から持ち替える。 */
export const STAFF_ONLY_KINDS: readonly string[] = CONTRACT_STAFF_ONLY_KINDS

/** 新規作成で選べる種別（廃止した種別を除いたもの）。 */
export const CREATABLE_KINDS: readonly string[] = CONTRACT_CREATABLE_KINDS

/** その種別のスレを立てられるのは運営だけか。 */
export const isStaffOnlyKind = (kind: string): boolean => STAFF_ONLY_KINDS.includes(kind)

/** スレ削除のやり方。返信があるスレは本文だけ消す（D-BOARD-DELETE）。 */
export type ThreadDeleteMode = 'whole' | 'head-only'

/** 削除・非表示の投稿に出す伏字。本文は絶対に返さない（§7-6）。 */
export const DELETED_BODY_TEXT = 'この投稿は削除されました'
export const HIDDEN_BODY_TEXT = 'この投稿は運営が非表示にしました'

const ALLOW: PermissionResult = { ok: true }

const deny = (reason: PermissionDenyReason): PermissionResult => ({ ok: false, reason })

/** 生きている（削除も非表示もされていない）か。 */
const isAlive = (it: { deletedAt: number; hiddenAt: number }): boolean =>
  it.deletedAt === 0 && it.hiddenAt === 0

// ---------------------------------------------------------------------------
// 判断
// ---------------------------------------------------------------------------

/** 投稿禁止中か。期限ちょうど（`bannedUntil === now`）は明けたものとして扱う。 */
export function isBanned(actor: Actor, now: number): boolean {
  return actor.bannedUntil > now
}

/**
 * このスレに書き込めるか。
 * 未ログイン不可・投稿禁止中は不可・削除済み／非表示のスレは不可・
 * ロック中は staff だけ（運営の締めの一言を残せるようにする）。
 */
export function canPost(actor: Actor, thread: ThreadLike, now: number): PermissionResult {
  if (actor.userId === null) return deny('unauthorized')
  if (isBanned(actor, now)) return deny('banned')
  if (!isAlive(thread)) return deny('gone')
  if (thread.locked && actor.role !== 'staff') return deny('locked')
  return ALLOW
}

/**
 * この投稿を削除できるか。**自分の投稿だけ**（§7-4）。
 * staff でも他人の投稿は「削除」できない。運営がやるのは非表示（canModerate）で、
 * 消えたのが本人の意思か運営の判断かを、後から取り違えられないようにするため。
 */
export function canDeletePost(actor: Actor, post: PostLike): PermissionResult {
  if (actor.userId === null) return deny('unauthorized')
  if (post.userId !== actor.userId) return deny('forbidden')
  if (post.deletedAt !== 0) return deny('gone')
  return ALLOW
}

/** このスレを削除できるか。自分のスレだけ。消し方は threadDeleteMode が決める。 */
export function canDeleteThread(actor: Actor, thread: ThreadLike): PermissionResult {
  if (actor.userId === null) return deny('unauthorized')
  if (thread.userId !== actor.userId) return deny('forbidden')
  if (thread.deletedAt !== 0) return deny('gone')
  return ALLOW
}

/**
 * スレの消し方を決めるのに要る事実。
 *
 * **「生きている返信の数」（`ThreadLike.replyCount`）ではなく「行として在るか」を渡す。**
 * 一覧に出す `replyCount` は削除済み・非表示を除いた数なので、運営が返信を 1 件伏せると
 * 0 に戻る。その 0 を見て `whole` を選ぶと、スレ主の削除が他人の hidden 投稿にまで
 * `deleted_at` を刻み、`unhide_post` しても伏字が「本人が削除」のまま戻らなくなる
 *（＝運営の措置の可逆性が壊れる）。数えるのは seq>1 の行の有無だけにする。
 */
export type ThreadDeleteFacts = {
  /** seq>1 の投稿が 1 件でも在るか。**削除済み・非表示も数に入れる** */
  hasAnyReply: boolean
}

/**
 * スレの消し方（D-BOARD-DELETE / §7-5）。
 * 返信が 1 件でも「在った」なら `head-only` ＝ 本文（seq=1）だけ伏せ、返信は残す。
 * スレ主の削除で他人の発言を巻き添えにしないため、返信が 1 件も無いときだけ丸ごと消せる。
 */
export function threadDeleteMode(facts: ThreadDeleteFacts): ThreadDeleteMode {
  // 呼び忘れの保険。`functions/` は tsconfig の include に入っておらず（`include: ["src"]`）、
  // 引数の形を変えても `pnpm typecheck` は気づかない。ここで黙って undefined を受けると
  // 「返信あり」が `whole` に倒れ、**他人の投稿に deleted_at を刻む**ほうへ落ちる。
  // 壊れるなら 500 で止まるほうを選ぶ。
  if (typeof facts?.hasAnyReply !== 'boolean') {
    throw new TypeError('threadDeleteMode には { hasAnyReply } を渡す（seq>1 の行の有無）')
  }
  return facts.hasAnyReply ? 'head-only' : 'whole'
}

/**
 * この種別でスレを立てられるか（指摘1・指摘3）。
 *
 * 判定の順は `canPost` に揃える（unauthorized → banned → 種別）。揃えておくと
 * 「返信は 403 なのにスレ立ては 200」という食い違いが起きない。
 *
 * 断る理由は 2 つ。
 * - **廃止した種別**（`suggestion`）で立てようとした → `unsupported-kind`（400）。
 *   統合済みで、画面の選択肢にも出ない。API を直に叩いた場合だけここへ来る。
 * - **運営だけの種別**（`notice`）を member が立てようとした → `forbidden`（403）。
 *   返信はこの関数を通らない（`canPost`）ので、**お知らせにも誰でも返信できる**。
 *
 * `now` を受けるのは投稿禁止の判定に要るため（`canLike` と同じく渡し忘れを実行時に止める）。
 */
export function canCreateThread(actor: Actor, kind: string, now: number): PermissionResult {
  // `bannedUntil > undefined` は常に false ＝ 投稿禁止が黙って無効化される。
  // `functions/` は typecheck の対象外なので、渡し忘れはここで落とす。
  if (!Number.isFinite(now)) {
    throw new TypeError('canCreateThread には now（epoch ms）を渡す — 投稿禁止の期限を判定するため')
  }
  if (actor.userId === null) return deny('unauthorized')
  if (isBanned(actor, now)) return deny('banned')
  if (!CREATABLE_KINDS.includes(kind)) return deny('unsupported-kind')
  if (isStaffOnlyKind(kind) && actor.role !== 'staff') return deny('forbidden')
  return ALLOW
}

/** 運営操作（非表示・投稿禁止）ができるか。staff だけ。 */
export function canModerate(actor: Actor): PermissionResult {
  if (actor.userId === null) return deny('unauthorized')
  if (actor.role !== 'staff') return deny('forbidden')
  return ALLOW
}

/** 運営ステータスを付けられるか。staff かつ、種別が request / bug のときだけ。 */
export function canSetStatus(actor: Actor, thread: ThreadLike): PermissionResult {
  const moderate = canModerate(actor)
  if (!moderate.ok) return moderate
  if (thread.deletedAt !== 0) return deny('gone')
  if (!KINDS_WITH_STATUS.includes(thread.kind)) return deny('unsupported-kind')
  return ALLOW
}

/**
 * 👍 を押せるか。ログイン済みかつ、種別が request / bug のときだけ。
 *
 * **投稿禁止中は押せない**（`canPost` と同じ判定を通す）。👍 は D-BOARD-STATUS の
 * 「次に何を作るか」を決める票そのものなので、書き込みを止めた相手に票だけ動かせると、
 * 止めた意味が無いどころか順位付けが汚れる。
 *
 * **ロック中も押せない。** ロックは「この話は終わり」という運営の意思表示で、
 * 締めたあとに票数だけ動くと、締めた時点の数字を根拠にできなくなる。
 * ロック中に書けるのは staff だけ（`canPost`）だが、票は staff でも足さない
 *（運営が自分で順位を動かせる形にしない）。
 *
 * 判定の順は `canPost` に揃える（unauthorized → banned → gone → locked → 種別）。
 * 揃えておくと「返信は 403 なのに 👍 は 200」という食い違いが起きない。
 */
export function canLike(actor: Actor, thread: ThreadLike, now: number): PermissionResult {
  // `now` の渡し忘れは投稿禁止の判定が丸ごと効かなくなる（`bannedUntil > undefined` は
  // 常に false）。`functions/` は typecheck の対象外なので、ここで気づける形にしておく。
  if (!Number.isFinite(now)) {
    throw new TypeError('canLike には now（epoch ms）を渡す — 投稿禁止の期限を判定するため')
  }
  if (actor.userId === null) return deny('unauthorized')
  if (isBanned(actor, now)) return deny('banned')
  if (!isAlive(thread)) return deny('gone')
  if (thread.locked) return deny('locked')
  if (!KINDS_WITH_STATUS.includes(thread.kind)) return deny('unsupported-kind')
  return ALLOW
}

// ---------------------------------------------------------------------------
// 表示用への落とし込み
// ---------------------------------------------------------------------------

/** 表示用の投稿。本文は伏字に置き換わることがある。 */
export type VisiblePost<T extends PostLike> = T & {
  /** 伏字に置き換わっているか（UI が薄字で出すための印） */
  masked: boolean
}

/**
 * 削除・非表示の投稿を「本文を伏せた形」に落とす（§7-6）。
 * 一覧でも詳細でも必ずこれを通してから返す＝本文が漏れる経路を 1 本に絞る。
 * 削除と非表示が重なったときは削除を優先する（本人の意思のほうを先に出す）。
 */
export function visiblePost<T extends PostLike>(post: T): VisiblePost<T> {
  if (post.deletedAt !== 0) return { ...post, body: DELETED_BODY_TEXT, masked: true }
  if (post.hiddenAt !== 0) return { ...post, body: HIDDEN_BODY_TEXT, masked: true }
  return { ...post, masked: false }
}
