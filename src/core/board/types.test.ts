import {
  BoardMeResponseSchema,
  type ModerateInput,
  ModerateInputSchema,
  MyBoardPostSchema,
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
