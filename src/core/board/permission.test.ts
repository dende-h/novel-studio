import {
  type Actor,
  CREATABLE_KINDS,
  canCreateThread,
  canDeletePost,
  canDeleteThread,
  canLike,
  canModerate,
  canPost,
  canSetStatus,
  DELETED_BODY_TEXT,
  HIDDEN_BODY_TEXT,
  isBanned,
  isStaffOnlyKind,
  KINDS_WITH_STATUS,
  type PostLike,
  STAFF_ONLY_KINDS,
  STATUS_OF_REASON,
  type ThreadLike,
  threadDeleteMode,
  visiblePost,
} from './permission'
import {
  CREATABLE_KINDS as CONTRACT_CREATABLE_KINDS,
  KINDS_WITH_STATUS as CONTRACT_KINDS_WITH_STATUS,
  STAFF_ONLY_KINDS as CONTRACT_STAFF_ONLY_KINDS,
} from './types'

const NOW = 1_700_000_000_000

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: 'u1',
  role: 'member',
  bannedUntil: 0,
  ...over,
})

const thread = (over: Partial<ThreadLike> = {}): ThreadLike => ({
  userId: 'u1',
  kind: 'chat',
  locked: false,
  replyCount: 0,
  deletedAt: 0,
  hiddenAt: 0,
  ...over,
})

const post = (over: Partial<PostLike> = {}): PostLike => ({
  userId: 'u1',
  body: '秘密の本文',
  deletedAt: 0,
  hiddenAt: 0,
  ...over,
})

const anon = actor({ userId: null })
const staff = actor({ userId: 'staff1', role: 'staff' })

const reasonOf = (r: { ok: boolean } | { ok: false; reason: string }): string | null =>
  'reason' in r ? r.reason : null

describe('isBanned', () => {
  it('期限が未来なら禁止中、期限ちょうど・過去なら明けている', () => {
    expect(isBanned(actor({ bannedUntil: NOW + 1 }), NOW)).toBe(true)
    expect(isBanned(actor({ bannedUntil: NOW }), NOW)).toBe(false)
    expect(isBanned(actor({ bannedUntil: 0 }), NOW)).toBe(false)
  })
})

describe('canPost', () => {
  it('ログイン済み・生きているスレなら書ける', () => {
    expect(canPost(actor(), thread(), NOW)).toEqual({ ok: true })
  })

  it('未ログインは unauthorized', () => {
    expect(canPost(anon, thread(), NOW)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('投稿禁止中は banned', () => {
    expect(canPost(actor({ bannedUntil: NOW + 1000 }), thread(), NOW)).toEqual({
      ok: false,
      reason: 'banned',
    })
  })

  it('削除済み・非表示のスレには書けない', () => {
    expect(reasonOf(canPost(actor(), thread({ deletedAt: NOW }), NOW))).toBe('gone')
    expect(reasonOf(canPost(actor(), thread({ hiddenAt: NOW }), NOW))).toBe('gone')
  })

  it('ロック中は member が locked、staff は書ける', () => {
    expect(reasonOf(canPost(actor(), thread({ locked: true }), NOW))).toBe('locked')
    expect(reasonOf(canPost(actor(), thread({ locked: 1 }), NOW))).toBe('locked')
    expect(canPost(staff, thread({ locked: true }), NOW)).toEqual({ ok: true })
  })
})

describe('canDeletePost / canDeleteThread（§7-4）', () => {
  it('他人の投稿は消せない', () => {
    expect(canDeletePost(actor({ userId: 'u2' }), post({ userId: 'u1' }))).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('他人のスレは消せない', () => {
    expect(canDeleteThread(actor({ userId: 'u2' }), thread({ userId: 'u1' }))).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('staff でも他人の投稿・スレは「削除」できない（できるのは非表示だけ）', () => {
    expect(reasonOf(canDeletePost(staff, post({ userId: 'u1' })))).toBe('forbidden')
    expect(reasonOf(canDeleteThread(staff, thread({ userId: 'u1' })))).toBe('forbidden')
    // 非表示（モデレーション）は staff だけができる
    expect(canModerate(staff)).toEqual({ ok: true })
    expect(reasonOf(canModerate(actor()))).toBe('forbidden')
    expect(reasonOf(canModerate(anon))).toBe('unauthorized')
  })

  it('自分の投稿・スレは消せる。未ログインは unauthorized、削除済みは gone', () => {
    expect(canDeletePost(actor(), post())).toEqual({ ok: true })
    expect(canDeleteThread(actor(), thread())).toEqual({ ok: true })
    expect(reasonOf(canDeletePost(anon, post()))).toBe('unauthorized')
    expect(reasonOf(canDeletePost(actor(), post({ deletedAt: NOW })))).toBe('gone')
    expect(reasonOf(canDeleteThread(actor(), thread({ deletedAt: NOW })))).toBe('gone')
  })
})

describe('threadDeleteMode（D-BOARD-DELETE / §7-5）', () => {
  it('返信が付いたスレは head-only にしかならない', () => {
    expect(threadDeleteMode({ hasAnyReply: true })).toBe('head-only')
  })

  it('返信が 1 件も無いスレだけ丸ごと消せる', () => {
    expect(threadDeleteMode({ hasAnyReply: false })).toBe('whole')
  })

  it('運営が伏せた返信・本人が消した返信しか無くても head-only（他人の投稿を巻き添えにしない）', () => {
    // 一覧の replyCount は生きている返信しか数えないので、staff が 1 件 hide すると 0 に戻る。
    // その 0 で whole を選ぶと、スレ主の削除が他人の hidden 投稿に deleted_at を刻み、
    // unhide しても「本人が削除」の伏字のまま戻らなくなる。数えるのは行の有無だけ。
    expect(threadDeleteMode({ hasAnyReply: true })).toBe('head-only')
  })

  it('生きている返信の数（ThreadLike）を渡すと落ちる — 黙って whole に倒れない', () => {
    // functions/ は tsconfig の include 外で typecheck が効かないので、
    // 旧シグネチャのままの呼び出しは実行時に止める（安全側は「消さない」ではなく「止める」）。
    expect(() => {
      // @ts-expect-error 生きている返信の数では判定しない
      threadDeleteMode(thread({ replyCount: 0 }))
    }).toThrow(TypeError)
  })
})

describe('canSetStatus（D-BOARD-KIND）', () => {
  it('運営ステータスは staff かつ 要望（旧・目安箱）／不具合のときだけ', () => {
    for (const kind of KINDS_WITH_STATUS) {
      expect(canSetStatus(staff, thread({ kind }))).toEqual({ ok: true })
    }
    // 統合前の目安箱スレにも運営ステータスを付けたまま（既存のステータスが消えない）
    expect(canSetStatus(staff, thread({ kind: 'suggestion' }))).toEqual({ ok: true })
    // お知らせには運営ステータスを付けない
    expect(reasonOf(canSetStatus(staff, thread({ kind: 'notice' })))).toBe('unsupported-kind')
    expect(reasonOf(canSetStatus(staff, thread({ kind: 'chat' })))).toBe('unsupported-kind')
    expect(reasonOf(canSetStatus(actor(), thread({ kind: 'bug' })))).toBe('forbidden')
    expect(reasonOf(canSetStatus(anon, thread({ kind: 'bug' })))).toBe('unauthorized')
    expect(reasonOf(canSetStatus(staff, thread({ kind: 'bug', deletedAt: NOW })))).toBe('gone')
  })
})

describe('canLike（👍 は投稿ごと・0009）', () => {
  it('ログインしていれば、どの種別の書き込みにも押せる', () => {
    // 0009 以前は request / bug のスレだけだった。押したいのは「このスレッド」ではなく
    // 中の 1 つの書き込みで、それは雑談でも作品紹介でもお知らせでも変わらない。
    for (const kind of ['request', 'bug', 'suggestion', 'chat', 'intro', 'promo', 'notice']) {
      expect(canLike(actor(), thread({ kind }), post(), NOW)).toEqual({ ok: true })
    }
    expect(reasonOf(canLike(anon, thread({ kind: 'request' }), post(), NOW))).toBe('unauthorized')
  })

  it('伏せた投稿・伏せたスレには押せない（gone）', () => {
    // 本文が読めないものに票だけ入ると、何に賛同されたのか誰にも分からない数字が残る。
    expect(reasonOf(canLike(actor(), thread(), post({ deletedAt: NOW }), NOW))).toBe('gone')
    expect(reasonOf(canLike(actor(), thread(), post({ hiddenAt: NOW }), NOW))).toBe('gone')
    expect(reasonOf(canLike(actor(), thread({ hiddenAt: NOW }), post(), NOW))).toBe('gone')
    expect(reasonOf(canLike(actor(), thread({ deletedAt: NOW }), post(), NOW))).toBe('gone')
  })

  it('投稿禁止中は 👍 も押せない（書き込みを止めた相手に票だけ動かさせない）', () => {
    const banned = actor({ bannedUntil: NOW + 1000 })
    expect(canLike(banned, thread({ kind: 'request' }), post(), NOW)).toEqual({
      ok: false,
      reason: 'banned',
    })
    // canPost と同じ判定・同じ理由に揃っていること（返信は 403 なのに 👍 は 200、を作らない）
    expect(canPost(banned, thread({ kind: 'request' }), NOW)).toEqual({
      ok: false,
      reason: 'banned',
    })
    // 期限が切れたら押せる（isBanned と同じ「ちょうどは明け」の境界）
    expect(canLike(actor({ bannedUntil: NOW }), thread({ kind: 'request' }), post(), NOW)).toEqual({
      ok: true,
    })
  })

  it('ロック中のスレには 👍 を付けられない（staff でも足せない）', () => {
    // ロックは「この話は終わり」の意思表示。締めたあとに票だけ動くと、
    // 締めた時点の数字を順位付けの根拠にできなくなる。
    expect(reasonOf(canLike(actor(), thread({ locked: true }), post(), NOW))).toBe('locked')
    expect(reasonOf(canLike(actor(), thread({ locked: 1 }), post(), NOW))).toBe('locked')
    expect(reasonOf(canLike(staff, thread({ kind: 'bug', locked: true }), post(), NOW))).toBe(
      'locked',
    )
  })

  it('now を渡し忘れた canLike は落ちる（投稿禁止の判定が黙って無効化されない）', () => {
    expect(() => {
      // @ts-expect-error now は必須（bannedUntil > undefined は常に false になる）
      canLike(actor({ bannedUntil: NOW + 1000 }), thread({ kind: 'request' }), post())
    }).toThrow(TypeError)
  })
})

describe('canCreateThread（指摘1・指摘3）', () => {
  it('ふつうの種別は誰でも立てられる', () => {
    expect(canCreateThread(actor(), 'request', NOW)).toEqual({ ok: true })
    expect(canCreateThread(actor(), 'bug', NOW)).toEqual({ ok: true })
    expect(canCreateThread(actor(), 'chat', NOW)).toEqual({ ok: true })
  })

  it('お知らせを立てられるのは staff だけ（member は 403）', () => {
    expect(canCreateThread(staff, 'notice', NOW)).toEqual({ ok: true })
    expect(canCreateThread(actor(), 'notice', NOW)).toEqual({ ok: false, reason: 'forbidden' })
    expect(STATUS_OF_REASON.forbidden).toBe(403)
  })

  it('お知らせには運営しか書けない（返信も運営だけ）', () => {
    // お知らせは運営からの連絡で、掲示板ではない（D-BOARD-NOTICE）。
    // 話したいことは要望・不具合・雑談の器がある。
    expect(canPost(actor(), thread({ kind: 'notice', userId: 'staff1' }), NOW)).toEqual({
      ok: false,
      reason: 'forbidden',
    })
    expect(
      canPost(actor({ role: 'staff' }), thread({ kind: 'notice', userId: 'staff1' }), NOW),
    ).toEqual({ ok: true })
  })

  it('お知らせ以外は今までどおり誰でも書ける', () => {
    for (const kind of ['request', 'bug', 'chat', 'intro', 'promo', 'suggestion'] as const) {
      expect(canPost(actor(), thread({ kind }), NOW)).toEqual({ ok: true })
    }
  })

  it('統合済みの suggestion では新しく立てられない（400）', () => {
    // 画面の選択肢には出ないので、ここへ来るのは API を直に叩いた場合だけ。
    expect(canCreateThread(actor(), 'suggestion', NOW)).toEqual({
      ok: false,
      reason: 'unsupported-kind',
    })
    expect(canCreateThread(staff, 'suggestion', NOW)).toEqual({
      ok: false,
      reason: 'unsupported-kind',
    })
    // 知らない種別も同じ扱い
    expect(reasonOf(canCreateThread(actor(), 'unknown', NOW))).toBe('unsupported-kind')
  })

  it('未ログイン・投稿禁止中は種別より先に断る（canPost と同じ順・同じ理由）', () => {
    expect(canCreateThread(anon, 'request', NOW)).toEqual({ ok: false, reason: 'unauthorized' })
    const banned = actor({ bannedUntil: NOW + 1000 })
    expect(canCreateThread(banned, 'request', NOW)).toEqual({ ok: false, reason: 'banned' })
    // 立場より先に投稿禁止を見る（禁止中の staff がお知らせを立てられない）
    expect(reasonOf(canCreateThread({ ...staff, bannedUntil: NOW + 1000 }, 'notice', NOW))).toBe(
      'banned',
    )
    // 期限ちょうどは明け
    expect(canCreateThread(actor({ bannedUntil: NOW }), 'request', NOW)).toEqual({ ok: true })
  })

  it('now を渡し忘れた canCreateThread は落ちる（投稿禁止が黙って無効化されない）', () => {
    expect(() => {
      // @ts-expect-error now は必須（bannedUntil > undefined は常に false になる）
      canCreateThread(actor({ bannedUntil: NOW + 1000 }), 'request')
    }).toThrow(TypeError)
  })
})

describe('種別の表は契約（types.ts）と 1 つ', () => {
  // 書き写すと片方だけ増えて、「一覧には出るのにステータスが付けられない」
  // 「画面には出るのにサーバが 400 を返す」という食い違いになる。
  it('👍/ステータス・staff 限定・新規作成の 3 つとも types.ts と同じ中身', () => {
    expect(KINDS_WITH_STATUS).toEqual([...CONTRACT_KINDS_WITH_STATUS])
    expect(STAFF_ONLY_KINDS).toEqual([...CONTRACT_STAFF_ONLY_KINDS])
    expect(CREATABLE_KINDS).toEqual([...CONTRACT_CREATABLE_KINDS])
  })

  it('isStaffOnlyKind はお知らせにだけ真', () => {
    expect(isStaffOnlyKind('notice')).toBe(true)
    expect(isStaffOnlyKind('request')).toBe(false)
    expect(isStaffOnlyKind('unknown')).toBe(false)
  })
})

describe('visiblePost（§7-6）', () => {
  it('削除済みの投稿から本文が漏れない', () => {
    const v = visiblePost(post({ body: '秘密の本文', deletedAt: NOW }))
    expect(v.body).toBe(DELETED_BODY_TEXT)
    expect(v.masked).toBe(true)
    expect(JSON.stringify(v)).not.toContain('秘密の本文')
  })

  it('非表示の投稿から本文が漏れない（伏字を出し分ける）', () => {
    const v = visiblePost(post({ body: '秘密の本文', hiddenAt: NOW }))
    expect(v.body).toBe(HIDDEN_BODY_TEXT)
    expect(v.masked).toBe(true)
    expect(JSON.stringify(v)).not.toContain('秘密の本文')
  })

  it('削除と非表示が重なったら削除の伏字を出す', () => {
    expect(visiblePost(post({ deletedAt: NOW, hiddenAt: NOW })).body).toBe(DELETED_BODY_TEXT)
  })

  it('生きている投稿は本文も付随フィールドもそのまま返す', () => {
    const v = visiblePost({ ...post(), seq: 3 })
    expect(v.body).toBe('秘密の本文')
    expect(v.masked).toBe(false)
    expect(v.seq).toBe(3)
  })

  it('元の投稿を書き換えない', () => {
    const original = post({ deletedAt: NOW })
    visiblePost(original)
    expect(original.body).toBe('秘密の本文')
  })
})

describe('STATUS_OF_REASON', () => {
  it('理由をそのまま HTTP ステータスに写せる', () => {
    expect(STATUS_OF_REASON).toEqual({
      unauthorized: 401,
      forbidden: 403,
      banned: 403,
      locked: 409,
      gone: 404,
      'unsupported-kind': 400,
    })
  })

  it('拒否された結果の reason は必ず表に載っている', () => {
    const denied = canPost(anon, thread(), NOW)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(STATUS_OF_REASON[denied.reason]).toBe(401)
  })
})
