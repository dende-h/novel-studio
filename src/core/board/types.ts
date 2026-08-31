import { z } from 'zod'

/**
 * 掲示板（docs/requirement/09-board.md）の共有スキーマと定数。
 *
 * サーバ（`functions/api/board/`）・クライアント（`src/ui/_api/board.ts`）・画面が
 * 同じ形を見るための**契約の正本**。D1 の行は snake_case、ここから先は camelCase で、
 * 変換はサーバの store 層 1 箇所だけが行う。
 *
 * 後方互換の原則（CLAUDE.md）に従い、**後から足す欄は `.optional()`** で入れる。
 * 掲示板は新規テーブルなので既存の作品データには影響しないが、
 * 「旧クライアントが読めるレスポンス」を壊さない配慮は同じように要る。
 */

// ---------------------------------------------------------------------------
// 種別とステータス
// ---------------------------------------------------------------------------

/**
 * スレッドの種別（D-BOARD-KIND）。
 *
 * **`suggestion`（旧・目安箱）は `request`（要望）へ統合した**（廃止・新規作成では選べない）。
 * 「ひとことの受け皿＝目安箱／まとまった起票＝要望」と書き分けたが、画面上はどちらも
 * 「運営に伝える」で、どちらへ書くかの判断が利用者の負担にしかなっていなかった。
 *
 * **enum からは消さない。** STG・本番の `board_threads.kind` には `suggestion` の行が
 * そのまま残っており、enum から外すと `BoardThreadSchema.parse` が落ちて
 * **その 1 件どころか一覧ごと読めなくなる**（CLAUDE.md「後方互換性」）。
 * 残したうえで、表示は `boardKindLabel`（＝「要望」）、絞り込みは `kindsForFilter` で
 * `request` に合流させ、新規作成は `CREATABLE_KINDS` から外す。
 *
 * `notice`（お知らせ）は**運営だけが立てられる**種別（立てられるかの判定は
 * `src/core/board/permission.ts` の `canCreateThread`）。**返信も運営だけ**（`canPost` が同じ表を見る）。
 */
export const BOARD_KINDS = [
  'suggestion',
  'request',
  'bug',
  'chat',
  'intro',
  'promo',
  'notice',
] as const
export type BoardKind = (typeof BOARD_KINDS)[number]

/**
 * 画面に出す表記。**`suggestion` は「要望」と読み替える**（統合したので、
 * 既存の目安箱スレも要望として並ぶ）。ラベルの正本はこの表 1 つだけにする。
 */
export const boardKindLabel: Record<BoardKind, string> = {
  suggestion: '要望',
  request: '要望',
  bug: '不具合',
  chat: '雑談',
  intro: '自己紹介',
  promo: '作品紹介',
  notice: 'お知らせ',
}

/**
 * 廃止した種別 → 合流先。表示・絞り込み・新規作成の 3 か所が同じ表を見る。
 * 新しく足すときは、**保存済みの値は消さず**にここへ 1 行足す。
 */
export const KIND_ALIASES: Partial<Record<BoardKind, BoardKind>> = {
  suggestion: 'request',
}

/** 廃止された種別を合流先へ寄せた「いま生きている種別」。合流先が無ければそのまま。 */
export const canonicalKind = (kind: BoardKind): BoardKind => KIND_ALIASES[kind] ?? kind

/**
 * 一覧の絞り込みタブ 1 つが拾う種別。
 * 「要望」のタブは**旧 `suggestion` のスレも一緒に**出す（合流させた以上、
 * 片方だけタブから漏れると利用者には消えたように見える）。
 */
export const kindsForFilter = (kind: BoardKind): readonly BoardKind[] => {
  // 引数のほうも合流させる。旧クライアントや古いブックマークの `?kind=suggestion` が
  // 「該当なし」になって、要望の一覧を空で見せてしまうのを防ぐ。
  const target = canonicalKind(kind)
  return BOARD_KINDS.filter((k) => canonicalKind(k) === target)
}

/**
 * 新規作成で選べる種別。**廃止した種別（`suggestion`）は出さない**。
 * `notice` はここに居るが、選べるのは staff だけ（`canCreateThread` が 403 で弾く）。
 */
export const CREATABLE_KINDS: readonly BoardKind[] = BOARD_KINDS.filter(
  (kind) => canonicalKind(kind) === kind,
)

/** 運営（staff）だけが立てられる種別。返信の可否には効かない（お知らせにも誰でも返信できる）。 */
export const STAFF_ONLY_KINDS: readonly BoardKind[] = ['notice']

/**
 * 種別を選ぶ画面に添える一言（指摘2）。**要望と不具合を分けたままにする代わり**に、
 * どちらへ書けばよいかを 1 行で言う＝分かれていること自体で迷わせない。
 *
 * 「こうなったら嬉しい」「おかしな動きをした」と利用者の言葉で書く。
 * 「機能改善要望」「不具合報告」のような窓口語にすると、書く前に身構えさせてしまう。
 */
const REQUEST_HINT = '「こうなったら嬉しい」を書く場所です。👍 と運営の対応状況が付きます'

export const boardKindHint: Record<BoardKind, string> = {
  // 廃止済み。新規作成には出ないが、表を引き当てられない種別を作らないために持っておく
  suggestion: REQUEST_HINT,
  request: REQUEST_HINT,
  bug: '「おかしな動きをした」を書く場所です。再現する手順があれば添えてください。👍 と対応状況が付きます',
  chat: 'いま書いている話のことでも、雑談でも。運営の対応状況は付きません',
  intro: 'どんなものを書いているか、ひとことどうぞ。運営の対応状況は付きません',
  promo: '作品の URL を貼ると、表紙つきのカードで並びます',
  notice: '運営からのお知らせです。書けるのは運営だけで、返信は付きません',
}

/**
 * 👍 と運営ステータスが付く種別（D-BOARD-STATUS）。
 * 雑談や自己紹介にステータスを付けても意味がないので、器のほうを絞る。
 *
 * **`suggestion` を含める。** 統合前の目安箱スレには運営が付けたステータスが残っている。
 * ここから外すと、そのステータスが画面から消えて「対応してもらえたはずの記録」が失われる。
 * `notice` は入れない（運営からの連絡に 👍 と対応状況を付けても意味がない）。
 */
export const KINDS_WITH_STATUS: readonly BoardKind[] = ['suggestion', 'request', 'bug']

export const hasStatusUi = (kind: BoardKind): boolean => KINDS_WITH_STATUS.includes(kind)

/**
 * 運営ステータス（D-BOARD-STATUS）。`''` は「まだ付けていない」。
 * 空文字を混ぜるのは、付いていない状態を null と '' の 2 通りで表さないため。
 */
export const BOARD_STATUSES = [
  '',
  'received',
  'reviewing',
  'planned',
  'shipped',
  'declined',
] as const
export type BoardStatus = (typeof BOARD_STATUSES)[number]

export const boardStatusLabel: Record<BoardStatus, string> = {
  '': '',
  received: '受付',
  reviewing: '検討中',
  planned: '対応予定',
  shipped: '実装済み',
  declined: '今回は見送り',
}

/** 掲示板での立場。`staff` だけが非表示・投稿禁止・ステータス変更をできる。 */
export const BOARD_ROLES = ['member', 'staff'] as const
export type BoardRole = (typeof BOARD_ROLES)[number]

/** リンクカードの種類。`work` は grove の公開作品（D-BOARD-WORKCARD）、`none` は取得できなかった URL。 */
export const LINK_KINDS = ['ogp', 'work', 'none'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

// ---------------------------------------------------------------------------
// 上限
// ---------------------------------------------------------------------------

/**
 * 入力と流量の上限。**サーバとクライアントで同じ値を見る**（片方だけ緩いと、
 * 通ると思って書いた長文が保存時に弾かれる）。
 * `threadsPerDay` / `postsPerHour` はレート制限（D-BOARD-RATE）の閾値。
 */
export const BOARD_LIMITS = {
  /** スレッドのタイトル（文字数・コードポイント単位） */
  title: 80,
  /**
   * 投稿本文（スレ立て・返信の**入力**の上限）。
   *
   * 4000 字（原稿用紙 10 枚）から 1500 字へ下げた。掲示板は一覧とスレを行き来しながら
   * 拾い読みする器で、1 投稿がそこまで長いと読む側が先に疲れる。1500 字なら
   * 原稿用紙 4 枚弱・スマホで数回スクロールすれば読み切れる。書き切れない話は
   * 返信で足せばよく、上限は「1 回の書き込みの長さ」を決めるためだけにある。
   *
   * **効かせるのは入力スキーマ（`CreateThreadInputSchema` / `CreatePostInputSchema`）だけ。**
   * 保存済みを読む `BoardPostSchema.body` に max を付けると、4000 字時代に書かれた投稿が
   * parse で落ち、そのスレが丸ごと開けなくなる（CLAUDE.md「後方互換性」）。
   */
  body: 1500,
  /** 表示名 */
  displayName: 24,
  /** アンケートの質問 */
  pollQuestion: 120,
  /** アンケートの選択肢 1 つ */
  pollOption: 60,
  /** アンケートの選択肢の数 */
  pollOptionCount: 8,
  /** 運営がステータスに添える一言 */
  statusNote: 200,
  /** 通報の理由 */
  reportReason: 500,
  /** 1 投稿でリンクカードにする URL の数（3 本目以降はリンクだけ・D-BOARD-OGPCACHE） */
  linksPerPost: 2,
  /**
   * 1 日に立てられるスレッド数（**運営は対象外**・`functions/api/board/threads.ts`）。
   *
   * 3 本から 10 本へ緩めた。この上限が守っているのは**一覧の読みやすさ**で、
   * サーバの資源ではない（1 スレは D1 の 2 行だけ。外向きの取得は OGP だけで、
   * そちらは投稿単位の `postsPerHour` が縛っている）。一人が並べると他の人の話が
   * 下へ押し出される、という一点のために置いている。
   *
   * **外しはしない。** スレ立ては投稿枠も食う（本文が `board_posts` の 1 件）ので、
   * 日次の上限を外しても 10 件/時＝1 日 240 本までは立てられる。その気になった
   * 一人で一覧が埋まり、消して回るのが運営の仕事になる。
   *
   * 10 本なら、ふつうに使っていて当たることはまずない。3 本は運営自身が引っかかり、
   * 呼び水スレを画面から立てられなかった（そこは staff の除外で直した）。
   */
  threadsPerDay: 10,
  /** 1 時間に書ける投稿数 */
  postsPerHour: 10,
  /** 一覧に出す本文の抜粋 */
  excerpt: 120,
} as const

// ---------------------------------------------------------------------------
// 保存されるもの
// ---------------------------------------------------------------------------

const kindSchema = z.enum(BOARD_KINDS)
const statusSchema = z.enum(BOARD_STATUSES)

/**
 * 掲示板の表示名（D-BOARD-NAME）。記名式なので、これが無いと投稿できない。
 * `deletedAt` はアカウントを消したあとの伏せ字表示に使う（投稿そのものは残す）。
 */
export const BoardProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  role: z.enum(BOARD_ROLES).default('member'),
  /** 投稿禁止の期限（epoch ms・0 は禁止なし） */
  bannedUntil: z.number().default(0),
  /** 退会した時刻（epoch ms・0 は在籍中）。0 以外なら表示名を伏せる */
  deletedAt: z.number().default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type BoardProfile = z.infer<typeof BoardProfileSchema>

/** 投稿者の見え方（画面に出すぶんだけ。userId は出さない）。 */
export const BoardAuthorSchema = z.object({
  displayName: z.string(),
  /** 運営バッジを出すか */
  staff: z.boolean().default(false),
  /** 退会済み（表示名を伏せている） */
  retired: z.boolean().default(false),
})
export type BoardAuthor = z.infer<typeof BoardAuthorSchema>

/** 1 投稿。スレ本文は `seq === 1`（設計 §4）。 */
export const BoardPostSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  /** スレ内の連番。1 がスレ本文 */
  seq: z.number(),
  author: BoardAuthorSchema,
  /** 自分の投稿か（削除ボタンを出すかの判断に使う） */
  mine: z.boolean().default(false),
  /**
   * 本文。削除・非表示のときは伏せ字が入る。
   * **`max` を付けない**（上限を下げる前に書かれた長い投稿を読めなくしないため・`BOARD_LIMITS.body`）。
   */
  body: z.string(),
  /** 返信先の seq（0 はなし） */
  replyTo: z.number().default(0),
  /** 削除済みか（本文は伏せ字） */
  deleted: z.boolean().default(false),
  /** 運営が非表示にしたか（本文は伏せ字） */
  hidden: z.boolean().default(false),
  createdAt: z.number(),
  /**
   * この投稿に付いた 👍 の数（migrations/0009_board_post_likes.sql）。
   * 👍 はスレッドではなく**投稿ごと**に付く＝どの書き込みに賛同が集まったかが分かる。
   */
  likeCount: z.number().default(0),
  /** 自分が 👍 しているか（未ログインは false） */
  liked: z.boolean().default(false),
  /** この投稿に貼られたリンクのカード（無ければ空配列） */
  links: z.array(z.lazy(() => LinkCardSchema)).default([]),
})
export type BoardPost = z.infer<typeof BoardPostSchema>

/** 一覧に出すスレッド 1 行（本文は抜粋のみ）。 */
export const BoardThreadSchema = z.object({
  id: z.string(),
  kind: kindSchema,
  title: z.string(),
  author: BoardAuthorSchema,
  mine: z.boolean().default(false),
  status: statusSchema.default(''),
  statusNote: z.string().default(''),
  /** `shipped` のときに添えるリリース版 */
  shippedVersion: z.string().default(''),
  pinned: z.boolean().default(false),
  locked: z.boolean().default(false),
  replyCount: z.number().default(0),
  /**
   * スレ本文（seq=1）に付いた 👍 の数。👍 は投稿ごとに付くので、一覧に出す 1 つの数字は
   * 「スレを立てた人の言い分に何人が賛同したか」＝本文の数にする
   *（migrations/0009_board_post_likes.sql）。
   */
  likeCount: z.number().default(0),
  /** 自分がスレ本文に 👍 しているか */
  liked: z.boolean().default(false),
  /** アンケートが付いているか（一覧では中身を返さない） */
  hasPoll: z.boolean().default(false),
  /** 一覧用の本文抜粋 */
  excerpt: z.string().default(''),
  createdAt: z.number(),
  /** 最終書き込み時刻。一覧の既定の並び順（設計 §2） */
  bumpedAt: z.number(),
  deleted: z.boolean().default(false),
})
export type BoardThread = z.infer<typeof BoardThreadSchema>

/** 保存されたアンケート。票数は含めない（開示判定は PollResult 側の仕事）。 */
export const BoardPollSchema = z.object({
  threadId: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  multiple: z.boolean().default(false),
  /** 締切（epoch ms・これを含む以降は締切後） */
  closesAt: z.number(),
  createdAt: z.number(),
})
export type BoardPoll = z.infer<typeof BoardPollSchema>

/** 1 票。`choices` は選択肢の index。 */
export const BoardVoteSchema = z.object({
  threadId: z.string(),
  choices: z.array(z.number()),
  createdAt: z.number(),
})
export type BoardVote = z.infer<typeof BoardVoteSchema>

/**
 * 画面へ返すアンケート。**投票前かつ締切前は `counts` / `total` を返さない**
 * （D-BOARD-POLL）。0 埋めにすると「0 票」と誤読できるので、伏せるときは null にする。
 * 実際の判定は `src/core/board/poll.ts` の `pollResultFor` 1 本に閉じてある。
 */
export const PollResultSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  multiple: z.boolean(),
  closesAt: z.number(),
  closed: z.boolean(),
  /** 自分が投票済みか */
  voted: z.boolean(),
  /** 自分が選んだ index（未投票は null） */
  myChoices: z.array(z.number()).nullable(),
  /** 票数を開示してよい状態か（voted || closed） */
  revealed: z.boolean(),
  /** 選択肢ごとの票数。伏せるときは null */
  counts: z.array(z.number()).nullable(),
  /** 1 票以上を投じた人数。counts の合計ではない（複数選択があるため） */
  total: z.number().nullable(),
})
export type PollResult = z.infer<typeof PollResultSchema>

/**
 * 外部リンクのカード（D-BOARD-LINK / D-BOARD-OGPIMG）。
 * `imageUrl` は**画像ホストが許可表にあるときだけ**入り、外なら空文字＝テキストカードに落ちる。
 */
export const LinkCardSchema = z.object({
  url: z.string(),
  /** 表示に必ず添えるドメイン（リンクの見た目と飛び先が食い違わないように） */
  host: z.string(),
  kind: z.enum(LINK_KINDS),
  title: z.string().default(''),
  description: z.string().default(''),
  imageUrl: z.string().default(''),
  siteName: z.string().default(''),
})
export type LinkCard = z.infer<typeof LinkCardSchema>

/** スレッド 1 本の詳細（投稿・アンケート込み）。 */
export const BoardThreadDetailSchema = z.object({
  thread: BoardThreadSchema,
  posts: z.array(BoardPostSchema),
  poll: PollResultSchema.nullable().default(null),
  /** 自分が書き込めるか（未ログイン・投稿禁止・ロックの判定済み） */
  canPost: z.boolean().default(false),
})
export type BoardThreadDetail = z.infer<typeof BoardThreadDetailSchema>

// ---------------------------------------------------------------------------
// API のレスポンス（封筒）
// ---------------------------------------------------------------------------

/**
 * `GET /api/board/threads` が返す封筒。
 * `nextCursor` が null なら次のページは無い（空配列と「終わり」を取り違えないため、
 * 続きの有無はカーソルの有無だけで表す）。
 *
 * 画面（`src/ui/`）は `functions/` を import できない（workers-types が src に混ざる）ので、
 * レスポンスの形は必ずここに置く。
 */
export const ThreadListResponseSchema = z.object({
  threads: z.array(BoardThreadSchema),
  nextCursor: z.string().nullable().default(null),
})
export type ThreadListResponse = z.infer<typeof ThreadListResponseSchema>

/**
 * 「自分の書き込み」1 件（`GET/PUT /api/board/me`）。
 * **本文は抜粋だけ**（一覧の 1 行に出すもので、読むのはスレを開いてから）。
 * 削除・非表示のときは抜粋そのものが伏字に置き換わる（§7-6）。
 *
 * `threadKind` の `''` は「スレ行が引けなかった」＝種別が分からない状態。
 * 種別の enum に空文字を混ぜず、ここでだけ union にしているのは、
 * 「掲示板の種別」と「表示できる情報が欠けている」を別のものとして扱うため。
 */
export const MyBoardPostSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  /** 置かれているスレの見出し（スレ行が引けなければ空） */
  threadTitle: z.string().default(''),
  threadKind: z.union([kindSchema, z.literal('')]).default(''),
  /** スレ内の連番。1 は自分が立てたスレの本文 */
  seq: z.number(),
  /** 本文の抜粋。削除・非表示のときは伏字（§7-6） */
  excerpt: z.string().default(''),
  replyTo: z.number().default(0),
  deleted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  createdAt: z.number(),
})
export type MyBoardPost = z.infer<typeof MyBoardPostSchema>

/**
 * `GET/PUT /api/board/me` が返す形。
 * プロフィール未登録なら `profile` は null（画面は表示名の設定ダイアログを出す）。
 * `banned` は `profile.bannedUntil` と現在時刻の比較を画面に再実装させないための結論。
 */
export const BoardMeResponseSchema = z.object({
  profile: BoardProfileSchema.nullable().default(null),
  /** いま投稿禁止中か */
  banned: z.boolean().default(false),
  posts: z.array(MyBoardPostSchema).default([]),
})
export type BoardMeResponse = z.infer<typeof BoardMeResponseSchema>

// ---------------------------------------------------------------------------
// API の入力（サーバがこれで parse して 400 を返す）
// ---------------------------------------------------------------------------

const trimmed = (max: number) => z.string().trim().min(1).max(max)

/** アンケートの作成入力。締切の未来判定は poll.ts の `validatePollInput` が行う。 */
export const PollInputSchema = z.object({
  question: trimmed(BOARD_LIMITS.pollQuestion),
  options: z.array(trimmed(BOARD_LIMITS.pollOption)).min(2).max(BOARD_LIMITS.pollOptionCount),
  multiple: z.boolean().optional().default(false),
  closesAt: z.number().int().positive(),
})
export type PollInput = z.infer<typeof PollInputSchema>

export const CreateThreadInputSchema = z.object({
  kind: kindSchema,
  title: trimmed(BOARD_LIMITS.title),
  body: trimmed(BOARD_LIMITS.body),
  /** アンケートを添える場合のみ */
  poll: PollInputSchema.optional(),
})
export type CreateThreadInput = z.infer<typeof CreateThreadInputSchema>

export const CreatePostInputSchema = z.object({
  body: trimmed(BOARD_LIMITS.body),
  /** 返信先の seq（省略＝スレ全体への返信） */
  replyTo: z.number().int().nonnegative().optional().default(0),
})
export type CreatePostInput = z.infer<typeof CreatePostInputSchema>

export const VoteInputSchema = z.object({
  choices: z.array(z.number().int().nonnegative()).min(1).max(BOARD_LIMITS.pollOptionCount),
})
export type VoteInput = z.infer<typeof VoteInputSchema>

export const ReportInputSchema = z.object({
  postId: z.string().min(1),
  reason: trimmed(BOARD_LIMITS.reportReason),
})
export type ReportInput = z.infer<typeof ReportInputSchema>

export const ProfileInputSchema = z.object({
  displayName: trimmed(BOARD_LIMITS.displayName),
})
export type ProfileInput = z.infer<typeof ProfileInputSchema>

/** 運営がステータス・ピン・ロックを変えるときの入力（省略した項目は据え置き）。 */
export const ThreadPatchInputSchema = z.object({
  status: statusSchema.optional(),
  statusNote: z.string().max(BOARD_LIMITS.statusNote).optional(),
  shippedVersion: z.string().max(40).optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
})
export type ThreadPatchInput = z.infer<typeof ThreadPatchInputSchema>

/**
 * 運営の措置（非表示・投稿禁止）。**削除系の action は置かない**（§7-4。
 * 消えたのが本人の意思か運営の判断かを取り違えないため。詳しくは
 * `functions/api/board/moderate.ts` の冒頭）。
 *
 * `hide_thread` / `unhide_thread` があるのは、**タイトルは投稿本文とは別の欄**だから。
 * スレ本文（seq=1）を `hide_post` で伏せても、タイトルは `board_threads.title` に残り、
 * 一覧にも詳細にも出続ける。タイトルは利用者が 80 字自由に書ける欄なので、
 * 誹謗中傷や個人情報を書かれたときに一覧から下ろす手段が要る（`board_threads.hidden_at`）。
 */
export const ModerateInputSchema = z
  .object({
    action: z.enum([
      'hide_post',
      'unhide_post',
      'hide_thread',
      'unhide_thread',
      'ban_user',
      'unban_user',
      'block_link',
    ]),
    postId: z.string().optional(),
    /** `hide_thread` / `unhide_thread` の対象 */
    threadId: z.string().optional(),
    userId: z.string().optional(),
    url: z.string().optional(),
    /** 投稿禁止の期限（epoch ms） */
    bannedUntil: z.number().optional(),
  })
  .refine(
    (input) => input.action !== 'ban_user' || Boolean(input.userId?.trim() || input.postId?.trim()),
    {
      // 掲示板 API はどのレスポンスにも user_id を出さない（設計どおり・出すと記名式の
      // 表示名と Clerk の ID が結びつく）。その結果、画面から荒らしを指す手段が無く、
      // ban が SQL の直接実行でしか打てなくなっていた。そこで **投稿を指せば足りる**
      // 形にする（サーバが postId → 投稿者を引く）。userId を直接渡す道は、
      // 通報キューを SQL で見た運営がそのまま打てるように残す。
      // どちらも無ければ「誰を止めるのか」が決まらないので入口で弾く。
      message: 'ban_user には userId か postId のどちらかが要る',
      path: ['userId'],
    },
  )
export type ModerateInput = z.infer<typeof ModerateInputSchema>
