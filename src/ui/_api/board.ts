/**
 * 掲示板の API クライアント（`/api/board/*`・設計 docs/requirement/09-board.md §5）。
 *
 * このファイルの仕事は 3 つだけ。
 *   1. **URL の組み立て**（対象そのものは `?id=`、親スレの指定は `?thread=`）
 *   2. **認証ヘッダ**（`Authorization: Bearer`）。**一覧と詳細は未ログインでも読める**ので、
 *      トークンが無ければヘッダを付けずに叩く（§2）
 *   3. **応答を `BoardResult` に畳む**。通信不能も JSON でない応答も例外にしない
 *
 * 判断は持たない。何が書けるか・何を伏せるかはサーバと `src/core/board/` が決めており、
 * ここでそれを書き直すと、片方だけ緩んだときに誰も気づけない。
 *
 * レスポンスは `src/core/board/types.ts` の Zod スキーマで検証してから返す。
 * サーバとクライアントは同じ契約（同じリポジトリ・同じデプロイ）を見ているので、
 * 形がずれたなら**画面に出す前に止めたほうが安全**という判断。壊れた形が
 * `undefined` のまま画面まで流れると、原因の分からない白画面になる。
 */

import type { ThreadDeleteMode } from '@/core/board/permission'
import type {
  BoardKind,
  BoardMeResponse,
  BoardThread,
  BoardThreadDetail,
  CreatePostInput,
  CreateThreadInput,
  ModerateInput,
  PollResult,
  ReportInput,
  ThreadListResponse,
  ThreadPatchInput,
} from '@/core/board/types'
import {
  BoardMeResponseSchema,
  BoardThreadDetailSchema,
  BoardThreadSchema,
  PollResultSchema,
  ThreadListResponseSchema,
} from '@/core/board/types'

type GetToken = () => Promise<string | null>

// ---------------------------------------------------------------------------
// 結果の形
// ---------------------------------------------------------------------------

/**
 * すべての関数が返す形。**例外は投げない**（通信断も JSON でない応答も `ok: false`）。
 *
 * `code` はサーバが返した `error` の値（`profile_required` / `locked` / `banned` ほか）。
 * 画面はこれで分岐する。`message` は**そのまま出せる日本語**で、対応表は
 * `BOARD_ERROR_MESSAGES`（このファイルの下）1 つだけにある。
 *
 * `status` は HTTP のステータス（通信できなかったときは 0）。分岐には使わず、
 * 想定外の応答を調べるときの手掛かりに残してある。
 * `bannedUntil` は `code === 'banned'` のときだけサーバが添える投稿禁止の期限（epoch ms）。
 */
export type BoardResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; status: number; bannedUntil?: number }

/** 運営の措置（`POST /api/board/moderate`）の結果。打った action がそのまま返る。 */
export interface ModerateResult {
  action: ModerateInput['action']
  postId?: string
  threadId?: string
  /** `ban_user` を `userId` 直指定で打ったときだけ返る（postId 経由では返らない） */
  userId?: string
  hidden?: boolean
  bannedUntil?: number
  urlKey?: string
  url?: string
}

/** 表示名の設定（`PUT /api/board/me`）の結果。`created` は初回登録（201）か。 */
export interface SetDisplayNameResult {
  me: BoardMeResponse
  /** true なら初回登録（画面は「登録しました」と「変更しました」を出し分けられる） */
  created: boolean
}

// ---------------------------------------------------------------------------
// エラーコード → 画面に出す日本語
// ---------------------------------------------------------------------------

/**
 * サーバの `error` を、そのまま画面に出せる文にする表。
 *
 * 書き方は「何が起きたか（事実）＋ 次にできること（一歩）」の 2 要素（toc-copy）。
 * **「エラーが発生しました」で済ませない。** 掲示板で詰まるのはたいてい
 * 「ログインしていない」「表示名を決めていない」「上限に当たった」のどれかで、
 * どれも次の一手がはっきりしている＝文言で解決できる。
 *
 * 表に無いコードは `FALLBACK_MESSAGE` に落ちる。サーバがコードを増やしても
 * 画面が壊れないようにしてあるが、**増やしたらここにも足す**。
 */
export const BOARD_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // --- 認証と登録 ---
  unauthorized: '書き込むにはログインが必要です。無料のアカウントで書けます',
  // 初回投稿の直前に表示名の設定ダイアログを出すための合図（設計 §2）。
  // 「権限がない」ではなく「あと 1 つ決めれば書ける」と読める文にする。
  profile_required: '表示名を決めると書き込めます',
  banned:
    '運営の判断で、いまは書き込みを止めています。心当たりがなければ、ヘルプからお問い合わせください',
  forbidden: 'この操作は許可されていません。消せるのは自分の書き込みだけです',

  // --- 表示名（validateDisplayName / upsertProfile の reason） ---
  empty: '表示名を入力してください',
  too_long: '表示名は24文字までです',
  invalid: 'この文字は表示名に使えません。ほかの名前でお試しください',
  reserved: 'この名前は使えません。ほかの名前でお試しください',
  duplicate: 'この表示名は、すでに使われています。ほかの名前でお試しください',

  // --- 対象の状態 ---
  not_found: '見つかりませんでした。削除されたか、リンクが古いのかもしれません',
  gone: 'この書き込みは、すでに削除されています。画面を読み込み直すと最新の状態になります',
  locked: 'このスレッドは書き込みを終了しています',
  // スレ立ての種別が不正なとき（画面からは起きない）。0009 以降、👍 では返らない。
  'unsupported-kind': 'この種別では、その操作はできません',
  use_thread_delete: 'スレッドの本文は、ここからは消せません。スレッドの削除をお使いください',

  // --- 上限（数値は public/board-guidelines.html と揃える・D-BOARD-RATE） ---
  too_many_posts: '書き込みは1時間に10件までです。時間をおいてから、もう一度お試しください',
  too_many_threads: 'スレッドは1日に10本までです。時間をおいてから、もう一度お試しください',
  rate_limited: '短い時間に操作が続きました。1分ほど待ってから、もう一度お試しください',

  // --- アンケート ---
  no_poll: 'このスレッドにアンケートはありません。画面を読み込み直してください',
  closed: 'このアンケートは締め切りました。結果はそのまま見られます',
  already_voted: 'すでに投票しています。1つのアカウントで1票までです',
  bad_choices: 'この選び方では投票できません。選択肢を確かめて、もう一度お試しください',
  bad_poll: 'アンケートを保存できませんでした。質問・選択肢・締切を確かめてください',

  // --- 入力と指定 ---
  bad_request: 'この内容では送信できませんでした。文字数を確かめて、もう一度お試しください',
  missing_id: '対象が分かりませんでした。画面を読み込み直してからお試しください',
  missing_thread: '対象のスレッドが分かりませんでした。画面を読み込み直してからお試しください',
  missing_post: '対象の書き込みが分かりませんでした。画面を読み込み直してからお試しください',
  missing_user: '対象の利用者が指定されていません',
  missing_url: '対象の URL が指定されていません',
  bad_url: 'この URL は読み取れませんでした。もう一度確かめてください',
  bad_banned_until: '投稿禁止の期限は、いまより先の日時を指定してください',
  cannot_ban_self: '自分を投稿禁止にはできません',

  // --- 書き込みの競合・通信・応答 ---
  // 本文が残っていることを先に言う（原稿が消えていない事実がいちばん要る情報）。
  conflict:
    'ほかの書き込みと重なって、保存できませんでした。本文はそのままです。もう一度送信してください',
  network: '通信できませんでした。通信環境を確認して、もう一度お試しください',
  bad_response: '応答を読み取れませんでした。しばらくしてから、もう一度お試しください',
  server_error: 'サーバー側で処理できませんでした。しばらくしてから、もう一度お試しください',
}

/** 表に無いコードのときの文。原因を断定せず、次の一手だけ渡す。 */
const FALLBACK_MESSAGE = 'うまく処理できませんでした。しばらくしてから、もう一度お試しください'

/** コード → 画面に出す文（表に無ければ既定文）。画面から直接呼んでもよい。 */
export const boardErrorMessage = (code: string): string =>
  BOARD_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE

// ---------------------------------------------------------------------------
// 応答の読み取り
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 応答本文の `error`。無ければ null（HTTP ステータスから引き直す）。 */
function errorCodeOf(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return typeof raw.error === 'string' && raw.error !== '' ? raw.error : null
}

/**
 * `error` が無い失敗（Pages が返す素の 500、HTML のエラーページ等）に当てるコード。
 * ステータスから引くので、**画面の分岐は本物のコードと同じ形のまま**書ける。
 */
function codeOfStatus(status: number): string {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  return 'server_error'
}

/**
 * `decode` が「読み取れなかった」を返すための印。**null を失敗の合図にしない**＝
 * 成功して `null` を返す操作（削除・通報のように本文が無いもの）と区別が付かなくなる。
 */
const DECODE_FAILED = Symbol('board-decode-failed')
type Decoded<T> = T | typeof DECODE_FAILED

const fail = (code: string, status: number, bannedUntil?: number): BoardResult<never> =>
  bannedUntil === undefined
    ? { ok: false, code, message: boardErrorMessage(code), status }
    : { ok: false, code, message: boardErrorMessage(code), status, bannedUntil }

/** 何を認証に使うか。`required` はトークンが無ければ fetch せずに `unauthorized`。 */
type AuthMode = 'required' | 'optional'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  auth: AuthMode
  getToken?: GetToken
  /** JSON で送る本文（省略すると content-type も付けない） */
  body?: unknown
}

/**
 * 1 回のリクエスト。**ここだけが fetch を呼ぶ。**
 *
 * `decode` は成功応答（2xx）の本文を画面が使う形に写す。`DECODE_FAILED` を返したら
 * `bad_response`＝**形の合わない応答を成功として通さない**。
 *
 * トークンの取得（Clerk）が失敗しても投げない。読み取りは未ログインで成立するので、
 * 期限切れのセッションを持った利用者の画面が真っ白にならないようにする。
 */
async function boardFetch<T>(
  path: string,
  opts: RequestOptions,
  decode: (raw: unknown, status: number) => Decoded<T>,
): Promise<BoardResult<T>> {
  const headers: Record<string, string> = {}

  let jwt: string | null = null
  if (opts.getToken) {
    try {
      jwt = await opts.getToken()
    } catch {
      jwt = null
    }
  }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  // 書き込み系は往復する前に断る（サーバの 401 と同じコードなので画面の分岐は 1 本で済む）。
  if (opts.auth === 'required' && !jwt) return fail('unauthorized', 401)

  const hasBody = opts.body !== undefined
  if (hasBody) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
    })
  } catch {
    return fail('network', 0)
  }

  // 本文が空でも JSON でなくても投げない（HTML のエラーページが返ることがある）。
  let raw: unknown = null
  try {
    raw = await res.json()
  } catch {
    raw = null
  }

  if (!res.ok) {
    const code = errorCodeOf(raw) ?? codeOfStatus(res.status)
    const bannedUntil =
      isRecord(raw) && typeof raw.bannedUntil === 'number' ? raw.bannedUntil : undefined
    return fail(code, res.status, bannedUntil)
  }

  const data = decode(raw, res.status)
  if (data === DECODE_FAILED) return fail('bad_response', res.status)
  return { ok: true, data }
}

/** `?a=b` を組み立てる。値が null / undefined / 空文字の項目は落とす。 */
function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

const str = (raw: unknown, key: string): string | null => {
  if (!isRecord(raw)) return null
  return typeof raw[key] === 'string' ? raw[key] : null
}

const num = (raw: unknown, key: string): number | null => {
  if (!isRecord(raw)) return null
  return typeof raw[key] === 'number' ? raw[key] : null
}

/** `{ ok: true }` だけが返る操作（削除・通報）。中身を見ずに成功として畳む。 */
const decodeAck = (): Decoded<null> => null

// ---------------------------------------------------------------------------
// スレッド
// ---------------------------------------------------------------------------

/**
 * スレッドの一覧（`GET /api/board/threads`）。
 * **未ログインでも読める**（§2）ので `getToken` は任意。渡さない／トークンが null なら
 * `Authorization` を付けずに叩き、各行の `mine` / `liked` は false で返る。
 *
 * `kind` は種別の絞り込み、`cursor` は前ページの `nextCursor`。
 * `nextCursor` が null なら次のページは無い（件数ではなくカーソルの有無で判定する）。
 */
export async function fetchThreads(
  opts: { kind?: BoardKind | null; cursor?: string | null; getToken?: GetToken } = {},
): Promise<BoardResult<ThreadListResponse>> {
  return await boardFetch(
    withQuery('/api/board/threads', { kind: opts.kind, cursor: opts.cursor }),
    { auth: 'optional', getToken: opts.getToken },
    (raw) => {
      const parsed = ThreadListResponseSchema.safeParse(raw)
      return parsed.success ? parsed.data : DECODE_FAILED
    },
  )
}

/**
 * スレッド 1 本（`GET /api/board/thread?id=`）。**未ログインでも読める**（§2）。
 * 返る `canPost` は「この閲覧者がいま書けるか」の結論なので、画面で組み直さない。
 */
export async function fetchThread(
  id: string,
  getToken?: GetToken,
): Promise<BoardResult<BoardThreadDetail>> {
  return await boardFetch(
    withQuery('/api/board/thread', { id }),
    { auth: 'optional', getToken },
    (raw) => {
      const parsed = BoardThreadDetailSchema.safeParse(raw)
      return parsed.success ? parsed.data : DECODE_FAILED
    },
  )
}

/**
 * スレ立て（`POST /api/board/threads`）。本文は投稿の 1 件目（seq=1）として入る。
 * サーバの `id` は**スレッドの id**だが、返信の id と並ぶと取り違えるので `threadId` に写す。
 *
 * 表示名が未設定なら `profile_required`（409）で返る＝画面は設定ダイアログを出す（§2）。
 */
export async function createThread(
  input: CreateThreadInput,
  getToken: GetToken,
): Promise<BoardResult<{ threadId: string; postId: string; seq: number }>> {
  return await boardFetch(
    '/api/board/threads',
    { method: 'POST', auth: 'required', getToken, body: input },
    (raw) => {
      const threadId = str(raw, 'id')
      const postId = str(raw, 'postId')
      const seq = num(raw, 'seq')
      if (threadId === null || postId === null || seq === null) return DECODE_FAILED
      return { threadId, postId, seq }
    },
  )
}

/**
 * ステータス・ピン・ロックの変更（`PATCH /api/board/thread?id=`・**staff のみ**）。
 * 省略した項目は据え置き（1 欄の更新で他の欄を落とさない）。
 * サーバが更新後のスレを読み直して返すので、画面は結果を推測せずそのまま差し替えられる。
 */
export async function patchThread(
  id: string,
  patch: ThreadPatchInput,
  getToken: GetToken,
): Promise<BoardResult<{ thread: BoardThread }>> {
  return await boardFetch(
    withQuery('/api/board/thread', { id }),
    { method: 'PATCH', auth: 'required', getToken, body: patch },
    (raw) => {
      if (!isRecord(raw)) return DECODE_FAILED
      const parsed = BoardThreadSchema.safeParse(raw.thread)
      return parsed.success ? { thread: parsed.data } : DECODE_FAILED
    },
  )
}

/**
 * 自分のスレッドを削除（`DELETE /api/board/thread?id=`）。
 * `mode` は消えた範囲で、**`'head-only'` は本文だけ消えて返信が残った**という意味
 *（D-BOARD-DELETE）。画面はここを見て「スレッドを削除しました」と
 * 「本文を削除しました（返信は残ります）」を出し分ける。
 */
export async function deleteThread(
  id: string,
  getToken: GetToken,
): Promise<BoardResult<{ mode: ThreadDeleteMode }>> {
  return await boardFetch(
    withQuery('/api/board/thread', { id }),
    { method: 'DELETE', auth: 'required', getToken },
    (raw) => {
      const mode = str(raw, 'mode')
      return mode === 'whole' || mode === 'head-only' ? { mode } : DECODE_FAILED
    },
  )
}

// ---------------------------------------------------------------------------
// 投稿
// ---------------------------------------------------------------------------

/**
 * 返信（`POST /api/board/posts?thread=`）。`replyTo` は返信先の seq（0 ＝スレ全体へ）。
 * サーバの `id` は**投稿の id** なので `postId` に写す（スレの id と取り違えない）。
 */
export async function createPost(
  threadId: string,
  input: CreatePostInput,
  getToken: GetToken,
): Promise<BoardResult<{ postId: string; threadId: string; seq: number }>> {
  return await boardFetch(
    withQuery('/api/board/posts', { thread: threadId }),
    { method: 'POST', auth: 'required', getToken, body: input },
    (raw) => {
      const postId = str(raw, 'id')
      const seq = num(raw, 'seq')
      if (postId === null || seq === null) return DECODE_FAILED
      return { postId, threadId: str(raw, 'threadId') ?? threadId, seq }
    },
  )
}

/**
 * 自分の投稿を削除（`DELETE /api/board/posts?id=`）。**行は残り**、本文が
 * 「この投稿は削除されました」に変わる（D-BOARD-DELETE）。
 * スレ本文（seq=1）はここでは消せない（`use_thread_delete` で返る）。
 */
export async function deletePost(postId: string, getToken: GetToken): Promise<BoardResult<null>> {
  return await boardFetch(
    withQuery('/api/board/posts', { id: postId }),
    { method: 'DELETE', auth: 'required', getToken },
    decodeAck,
  )
}

// ---------------------------------------------------------------------------
// 👍・投票・通報
// ---------------------------------------------------------------------------

/**
 * 👍 のトグル（`POST /api/board/like?post=`）。**どちらにするかは送らない**＝
 * サーバが現在の状態を見て反転し、押した結果を返す。画面は返ってきた値で描き直す。
 * 押す相手はスレッドではなく**投稿 1 件**（migrations/0009_board_post_likes.sql）。
 */
export async function toggleLike(
  postId: string,
  getToken: GetToken,
): Promise<BoardResult<{ liked: boolean; likeCount: number }>> {
  return await boardFetch(
    withQuery('/api/board/like', { post: postId }),
    { method: 'POST', auth: 'required', getToken },
    (raw) => {
      if (!isRecord(raw) || typeof raw.liked !== 'boolean') return DECODE_FAILED
      const likeCount = num(raw, 'likeCount')
      return likeCount === null ? DECODE_FAILED : { liked: raw.liked, likeCount }
    },
  )
}

/**
 * アンケートへの投票（`POST /api/board/vote?thread=`）。`choices` は選択肢の index。
 * 1 アカウント 1 票で上書きはできない（2 回目は `already_voted`・締切後は `closed`）。
 * **成功すると票数の入った結果が返る**ので、投票のあとにスレを読み直さなくてよい。
 */
export async function vote(
  threadId: string,
  choices: readonly number[],
  getToken: GetToken,
): Promise<BoardResult<{ poll: PollResult }>> {
  return await boardFetch(
    withQuery('/api/board/vote', { thread: threadId }),
    { method: 'POST', auth: 'required', getToken, body: { choices: [...choices] } },
    (raw) => {
      if (!isRecord(raw)) return DECODE_FAILED
      const parsed = PollResultSchema.safeParse(raw.poll)
      return parsed.success ? { poll: parsed.data } : DECODE_FAILED
    },
  )
}

/**
 * 通報（`POST /api/board/reports`）。運営の作業キューに 1 件積むだけで、
 * 件数で投稿が消えることはない（D-BOARD-REPORT）。同じ投稿を何度通報しても結果は同じ。
 * 返るのは成否だけ＝件数も他人の通報も画面には出ない。
 */
export async function report(input: ReportInput, getToken: GetToken): Promise<BoardResult<null>> {
  return await boardFetch(
    '/api/board/reports',
    { method: 'POST', auth: 'required', getToken, body: input },
    decodeAck,
  )
}

// ---------------------------------------------------------------------------
// 自分（表示名・自分の書き込み）
// ---------------------------------------------------------------------------

/**
 * 自分の表示名・立場・投稿禁止の状態と、自分の書き込み（`GET /api/board/me`）。
 * **読み取りでもログインが要る**（一覧・詳細と違い、自分にしか意味がないため）。
 * `profile` が null なら表示名がまだ無い＝設定ダイアログを出す合図。
 */
export async function fetchMe(getToken: GetToken): Promise<BoardResult<BoardMeResponse>> {
  return await boardFetch('/api/board/me', { auth: 'required', getToken }, (raw) => {
    const parsed = BoardMeResponseSchema.safeParse(raw)
    return parsed.success ? parsed.data : DECODE_FAILED
  })
}

/**
 * 表示名の設定・変更（`PUT /api/board/me`）。初回登録も改名も同じ入口。
 * 成功すると更新後の `BoardMeResponse` がそのまま返るので、画面は読み直さなくてよい。
 * `created` は初回登録（201）か＝「登録しました」と「変更しました」を出し分けられる。
 *
 * 取れない名前は `reserved` / `duplicate`（409）、直せば通る不備は `empty` / `too_long` /
 * `invalid`（400）。どれも文言が違う＝利用者が次に何をすればよいか分かる。
 */
export async function setDisplayName(
  displayName: string,
  getToken: GetToken,
): Promise<BoardResult<SetDisplayNameResult>> {
  return await boardFetch(
    '/api/board/me',
    { method: 'PUT', auth: 'required', getToken, body: { displayName } },
    (raw, status) => {
      const parsed = BoardMeResponseSchema.safeParse(raw)
      return parsed.success ? { me: parsed.data, created: status === 201 } : DECODE_FAILED
    },
  )
}

// ---------------------------------------------------------------------------
// 運営（staff）
// ---------------------------------------------------------------------------

/**
 * 運営の措置（`POST /api/board/moderate`・**staff のみ**）。
 * できるのは非表示・投稿禁止・リンク遮断で、**削除は無い**（§7-4）。どれも可逆。
 *
 * 投稿禁止の対象は `userId` でも `postId` でも指せる。画面から打てるのは `postId` の
 * ほうだけで、**その場合サーバは user_id を返さない**（記名の表示名と Clerk の ID を
 * 結びつけない）。member が呼べば `forbidden`（403）。
 */
export async function moderate(
  input: ModerateInput,
  getToken: GetToken,
): Promise<BoardResult<ModerateResult>> {
  return await boardFetch(
    '/api/board/moderate',
    { method: 'POST', auth: 'required', getToken, body: input },
    (raw) => {
      if (!isRecord(raw)) return DECODE_FAILED
      const action = str(raw, 'action')
      if (action === null) return DECODE_FAILED
      const result: ModerateResult = { action: action as ModerateInput['action'] }
      const postId = str(raw, 'postId')
      if (postId !== null) result.postId = postId
      const threadId = str(raw, 'threadId')
      if (threadId !== null) result.threadId = threadId
      const userId = str(raw, 'userId')
      if (userId !== null) result.userId = userId
      if (typeof raw.hidden === 'boolean') result.hidden = raw.hidden
      const bannedUntil = num(raw, 'bannedUntil')
      if (bannedUntil !== null) result.bannedUntil = bannedUntil
      const urlKey = str(raw, 'urlKey')
      if (urlKey !== null) result.urlKey = urlKey
      const url = str(raw, 'url')
      if (url !== null) result.url = url
      return result
    },
  )
}
