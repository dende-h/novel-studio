import {
  BOARD_KINDS,
  BOARD_LIMITS,
  BoardMeResponseSchema,
  BoardPostSchema,
  BoardThreadSchema,
  boardKindHint,
  boardKindLabel,
  CREATABLE_KINDS,
  CreatePostInputSchema,
  CreateThreadInputSchema,
  canonicalKind,
  hasStatusUi,
  KINDS_WITH_STATUS,
  kindsForFilter,
  type ModerateInput,
  ModerateInputSchema,
  MyBoardPostSchema,
  STAFF_ONLY_KINDS,
  ThreadListResponseSchema,
} from './types'

/** 成功した parse から中身を取り出す（失敗なら落とす）。 */
const parseOk = (raw: unknown): ModerateInput => {
  const parsed = ModerateInputSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`通るはずの入力が弾かれた: ${JSON.stringify(raw)}`)
  return parsed.data
}

const rejects = (raw: unknown): boolean => !ModerateInputSchema.safeParse(raw).success

describe('ModerateInputSchema — スレッドの非表示（§7-4）', () => {
  it('hide_thread / unhide_thread が通る', () => {
    // スレ本文（seq=1）を hide_post で伏せてもタイトルは board_threads.title に残るので、
    // タイトルごと一覧から下ろす action が要る。
    expect(parseOk({ action: 'hide_thread', threadId: 't1' })).toEqual({
      action: 'hide_thread',
      threadId: 't1',
    })
    expect(parseOk({ action: 'unhide_thread', threadId: 't1' }).action).toBe('unhide_thread')
  })

  it('投稿の非表示・投稿禁止・リンク遮断は今までどおり通る', () => {
    expect(parseOk({ action: 'hide_post', postId: 'p1' }).postId).toBe('p1')
    expect(parseOk({ action: 'unhide_post', postId: 'p1' }).action).toBe('unhide_post')
    expect(parseOk({ action: 'unban_user', userId: 'u1' }).action).toBe('unban_user')
    expect(parseOk({ action: 'block_link', url: 'https://example.com/' }).action).toBe('block_link')
  })

  it('削除系の action は足されていない（消えたのが本人の意思か運営の判断かを混ぜない）', () => {
    expect(rejects({ action: 'delete_post', postId: 'p1' })).toBe(true)
    expect(rejects({ action: 'delete_thread', threadId: 't1' })).toBe(true)
    expect(rejects({ action: 'purge_thread', threadId: 't1' })).toBe(true)
  })
})

describe('ModerateInputSchema — ban_user の対象指定（指摘3）', () => {
  it('userId だけでも postId だけでも通る', () => {
    // 掲示板 API はどのレスポンスにも user_id を出さないので、画面からは
    // 「この投稿の人」としか指せない。postId 経由の間接指定を必ず残す。
    expect(parseOk({ action: 'ban_user', userId: 'u1', bannedUntil: 1 }).userId).toBe('u1')
    expect(parseOk({ action: 'ban_user', postId: 'p1', bannedUntil: 1 }).postId).toBe('p1')
    expect(parseOk({ action: 'ban_user', userId: 'u1', postId: 'p1', bannedUntil: 1 }).action).toBe(
      'ban_user',
    )
  })

  it('どちらも無い ban_user は弾く（誰を止めるのかが決まらない）', () => {
    expect(rejects({ action: 'ban_user', bannedUntil: 1 })).toBe(true)
    // 空文字・空白だけも「指定なし」に倒す（trim して判定している）
    expect(rejects({ action: 'ban_user', userId: '', postId: '', bannedUntil: 1 })).toBe(true)
    expect(rejects({ action: 'ban_user', userId: '   ', bannedUntil: 1 })).toBe(true)
  })

  it('ban_user 以外はこの縛りを受けない（不足はサーバが missing_* で返す）', () => {
    // hide_post に postId が無い場合などは moderate.ts が 400 missing_post を返す。
    // ここで一緒に弾くと、どの欄が足りないのかが bad_request に潰れて分からなくなる。
    expect(parseOk({ action: 'unban_user' }).action).toBe('unban_user')
    expect(parseOk({ action: 'hide_post' }).action).toBe('hide_post')
    expect(parseOk({ action: 'hide_thread' }).action).toBe('hide_thread')
  })
})

describe('レスポンスの封筒（UI が持つ契約）', () => {
  it('ThreadListResponseSchema は nextCursor を省略すると null になる', () => {
    const parsed = ThreadListResponseSchema.parse({ threads: [] })
    expect(parsed).toEqual({ threads: [], nextCursor: null })
    expect(ThreadListResponseSchema.parse({ threads: [], nextCursor: '1:2:t1' }).nextCursor).toBe(
      '1:2:t1',
    )
  })

  it('MyBoardPost はスレの見出しと種別を持ち、種別が引けないときは空文字', () => {
    const row = {
      id: 'p1',
      threadId: 't1',
      threadTitle: '要望です',
      threadKind: 'request',
      seq: 2,
      excerpt: '本文の抜粋',
      replyTo: 1,
      deleted: false,
      hidden: false,
      createdAt: 1_700_000_000_000,
    }
    expect(MyBoardPostSchema.parse(row)).toEqual(row)
    expect(MyBoardPostSchema.parse({ ...row, threadKind: '' }).threadKind).toBe('')
    expect(MyBoardPostSchema.safeParse({ ...row, threadKind: 'unknown' }).success).toBe(false)
  })

  it('BoardMeResponse は未登録なら profile が null', () => {
    expect(BoardMeResponseSchema.parse({ banned: false })).toEqual({
      profile: null,
      banned: false,
      posts: [],
    })
    const parsed = BoardMeResponseSchema.parse({
      profile: {
        userId: 'u1',
        displayName: '名無し',
        role: 'staff',
        bannedUntil: 0,
        deletedAt: 0,
        createdAt: 1,
        updatedAt: 2,
      },
      banned: true,
      posts: [],
    })
    expect(parsed.profile?.role).toBe('staff')
    expect(parsed.banned).toBe(true)
  })
})

describe('種別の統合（指摘1）と お知らせ（指摘3）', () => {
  it('suggestion は enum に残す（STG の既存レコードを読めなくしない）', () => {
    // 消すと board_threads.kind = 'suggestion' の行が parse で落ち、
    // その 1 件どころか一覧ごと読めなくなる。
    expect(BOARD_KINDS).toContain('suggestion')
    const thread = {
      id: 't1',
      kind: 'suggestion',
      title: '目安箱に書いた要望',
      author: { displayName: 'だれか' },
      createdAt: 1,
      bumpedAt: 2,
    }
    expect(BoardThreadSchema.parse(thread).kind).toBe('suggestion')
    expect(
      MyBoardPostSchema.parse({
        id: 'p1',
        threadId: 't1',
        threadKind: 'suggestion',
        seq: 1,
        createdAt: 1,
      }).threadKind,
    ).toBe('suggestion')
  })

  it('既存の目安箱スレは「要望」として表示する', () => {
    expect(boardKindLabel.suggestion).toBe('要望')
    expect(boardKindLabel.suggestion).toBe(boardKindLabel.request)
    expect(canonicalKind('suggestion')).toBe('request')
    expect(canonicalKind('request')).toBe('request')
    expect(canonicalKind('bug')).toBe('bug')
  })

  it('「要望」の絞り込みは目安箱のスレも拾う', () => {
    // 合流させた以上、片方だけタブから漏れると利用者には消えたように見える。
    expect([...kindsForFilter('request')].sort()).toEqual(['request', 'suggestion'])
    expect(kindsForFilter('bug')).toEqual(['bug'])
    expect(kindsForFilter('notice')).toEqual(['notice'])
    // 廃止した種別で引かれても空にしない（旧クライアントや古いブックマークの
    // ?kind=suggestion が「該当なし」で空の一覧を出さないように、合流先と同じ結果を返す）
    expect([...kindsForFilter('suggestion')].sort()).toEqual(['request', 'suggestion'])
  })

  it('新規作成の選択肢から suggestion を外す。notice は残す（立てられるのは staff だけ）', () => {
    expect(CREATABLE_KINDS).not.toContain('suggestion')
    expect(CREATABLE_KINDS).toContain('request')
    expect(CREATABLE_KINDS).toContain('notice')
    expect(STAFF_ONLY_KINDS).toEqual(['notice'])
  })

  it('👍 と運営ステータスは suggestion にも付いたまま（既存スレのステータスを保つ）', () => {
    expect(hasStatusUi('suggestion')).toBe(true)
    expect(hasStatusUi('request')).toBe(true)
    expect(hasStatusUi('bug')).toBe(true)
    // お知らせは運営からの連絡。👍 も対応状況も付けない
    expect(hasStatusUi('notice')).toBe(false)
    expect(KINDS_WITH_STATUS).not.toContain('notice')
  })

  it('お知らせの種別が保存・表示できる', () => {
    expect(BOARD_KINDS).toContain('notice')
    expect(boardKindLabel.notice).toBe('お知らせ')
    expect(
      BoardThreadSchema.parse({
        id: 't2',
        kind: 'notice',
        title: 'メンテナンスのお知らせ',
        author: { displayName: '運営', staff: true },
        createdAt: 1,
        bumpedAt: 1,
      }).kind,
    ).toBe('notice')
  })

  it('種別を選ぶときの一言が全種別にある（指摘2 — 要望と不具合を分けたまま迷わせない）', () => {
    for (const kind of BOARD_KINDS) expect(boardKindHint[kind].length).toBeGreaterThan(0)
    expect(boardKindHint.request).toContain('こうなったら嬉しい')
    expect(boardKindHint.bug).toContain('おかしな動きをした')
    // 統合した目安箱は要望と同じ説明（別の言い回しを 2 つ持たない）
    expect(boardKindHint.suggestion).toBe(boardKindHint.request)
  })
})

describe('本文の上限（指摘4）', () => {
  it('スレ立て・返信の入力は上限で弾く', () => {
    expect(BOARD_LIMITS.body).toBeLessThanOrEqual(2000)
    expect(BOARD_LIMITS.body).toBeGreaterThanOrEqual(1200)
    const ok = 'あ'.repeat(BOARD_LIMITS.body)
    const over = 'あ'.repeat(BOARD_LIMITS.body + 1)
    expect(
      CreateThreadInputSchema.safeParse({ kind: 'request', title: 't', body: ok }).success,
    ).toBe(true)
    expect(
      CreateThreadInputSchema.safeParse({ kind: 'request', title: 't', body: over }).success,
    ).toBe(false)
    expect(CreatePostInputSchema.safeParse({ body: ok }).success).toBe(true)
    expect(CreatePostInputSchema.safeParse({ body: over }).success).toBe(false)
  })

  it('上限を下げる前に書かれた長い投稿は読めたまま（保存済みには max を効かせない）', () => {
    // ここが max 付きだと、4000 字時代の投稿が parse で落ちてスレごと開けなくなる。
    const old = 'あ'.repeat(4000)
    const parsed = BoardPostSchema.parse({
      id: 'p9',
      threadId: 't9',
      seq: 1,
      author: { displayName: '昔の人' },
      body: old,
      createdAt: 1,
    })
    expect(parsed.body).toHaveLength(4000)
    // 一覧の抜粋（サーバが詰める欄）も同じ理由で丸めない
    expect(
      BoardThreadSchema.parse({
        id: 't9',
        kind: 'request',
        title: '長い要望',
        author: { displayName: '昔の人' },
        excerpt: old,
        createdAt: 1,
        bumpedAt: 1,
      }).excerpt,
    ).toHaveLength(4000)
  })
})
