import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'

/**
 * platform への直接投稿クライアント。
 * 失敗時にユーザーへ何を見せるかまで含めて固定する
 * （通信断・未サインイン・作者未登録は、それぞれ出す文言と導線が違う）。
 */

const ORIGIN = 'https://platform.example'
const work: Work = { id: 'w1', title: '作品', episodes: [] }

async function loadModule() {
  vi.stubEnv('VITE_PLATFORM_ORIGIN', ORIGIN)
  vi.resetModules()
  return import('./publish')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('publishWorkToPlatform', () => {
  it('Clerk の JWT を Bearer で載せ、schemaVersion 付きで送る', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, created: true, manageUrl: '/dashboard/works/x/episodes' }),
        {
          status: 201,
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishWorkToPlatform(async () => 'jwt-token', work)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/api/import/kotonoha`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token')
    expect(JSON.parse(init.body as string)).toEqual({ schemaVersion: 2, work })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.created).toBe(true)
      // 確認先は platform の絶対URLにして、そのまま開けるようにする
      expect(result.manageUrl).toBe(`${ORIGIN}/dashboard/works/x/episodes`)
    }
  })

  it('未サインインなら fetch せずに案内を返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishWorkToPlatform(async () => null, work)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: '公開するにはサインインが必要です' })
  })

  it('作者未登録なら登録先の絶対URLを添えて返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'not-author',
            message: '作者登録が必要です',
            registerUrl: '/dashboard',
          }),
          {
            status: 403,
          },
        ),
      ),
    )

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('作者登録が必要です')
      expect(result.registerUrl).toBe(`${ORIGIN}/dashboard`)
      // 公開ページはこの印で、先方へ飛ばさずその場に登録フォームを出す
      expect(result.needsAuthor).toBe(true)
    }
  })

  it('通信に失敗したら接続エラーの文言を返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result).toEqual({
      ok: false,
      message: '公開先に接続できませんでした。通信環境を確認してください',
    })
  })

  it('本文が読めないエラー応答でもステータスから文言を決める', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 413 })))

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('作品が大きすぎます。話を分けて送ってください')
    }
  })

  it('公開先が未設定なら投稿を試みない', async () => {
    vi.stubEnv('VITE_PLATFORM_ORIGIN', '')
    vi.resetModules()
    const { publishWorkToPlatform, isPublishAvailable } = await import('./publish')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(isPublishAvailable).toBe(false)
    const result = await publishWorkToPlatform(async () => 'jwt', work)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: '公開先が設定されていません' })
  })
})

describe('toPlatformPayload（送信する投稿設定の組み立て）', () => {
  it('契約にあるキーだけを残し、ローカル専用の記録は落とす', async () => {
    const { toPlatformPayload } = await loadModule()

    expect(
      toPlatformPayload({
        genre: 'SF',
        tags: ['宇宙'],
        declaredAllAges: true,
        declaredOriginal: true,
        visibility: 'public',
        isCompleted: false,
        kind: 'serial',
        lastPublishedAt: 123,
        workUrl: 'https://platform.example/works/x',
        manageUrl: 'https://platform.example/dashboard',
      }),
    ).toEqual({
      genre: 'SF',
      tags: ['宇宙'],
      declaredAllAges: true,
      declaredOriginal: true,
      visibility: 'public',
      isCompleted: false,
      kind: 'serial',
    })
  })

  it('契約のキーが1つも無ければ undefined（＝platform ごと省略して v1 相当にする）', async () => {
    const { toPlatformPayload } = await loadModule()
    expect(toPlatformPayload(undefined)).toBeUndefined()
    expect(toPlatformPayload({})).toBeUndefined()
    expect(toPlatformPayload({ lastPublishedAt: 1 })).toBeUndefined()
  })

  it('false や空配列は「指定なし」ではないので残す', async () => {
    const { toPlatformPayload } = await loadModule()
    expect(toPlatformPayload({ declaredAllAges: false, tags: [] })).toEqual({
      declaredAllAges: false,
      tags: [],
    })
  })
})

describe('toBundleWork（送信するバンドルの work）', () => {
  it('ローカル専用キーを落とした platform に差し替える', async () => {
    const { toBundleWork } = await loadModule()
    const bundle = toBundleWork({
      ...work,
      platform: { visibility: 'draft', lastPublishedAt: 999, manageUrl: 'https://x/dashboard' },
    })
    expect(bundle.platform).toEqual({ visibility: 'draft' })
  })

  it('投稿設定を持たない作品は platform キーごと落とす（v1 と同じ扱い）', async () => {
    const { toBundleWork } = await loadModule()
    const bundle = toBundleWork({ ...work, platform: { lastPublishedAt: 999 } })
    expect('platform' in bundle).toBe(false)
  })

  // 用語集そのものは読者へ送る（先方が段階公開する）。その中の作者メモだけは非公開の器なので、
  // 他の項目を巻き込まずに、ここで確実に落ちることを固定する。
  it('用語集は送るが、作者メモだけは落とす（公開情報は summary へ一本化）', async () => {
    const { toBundleWork } = await loadModule()
    const bundle = toBundleWork({
      ...work,
      glossary: [
        {
          id: 'g1',
          name: 'ミア',
          aliases: ['少女'],
          summary: '旅の同行者',
          body: '本文に出る詳しい説明',
          authorNote: '正体は管理AI。第六編まで伏せる',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    const entry = bundle.glossary?.[0]
    expect(entry).toBeDefined()
    expect('authorNote' in (entry ?? {})).toBe(false)
    // 旧形式（summary + body）は summary へ結合して送る＝先方は summary だけで公開情報の全文
    expect('body' in (entry ?? {})).toBe(false)
    expect(entry).toMatchObject({
      id: 'g1',
      name: 'ミア',
      aliases: ['少女'],
      summary: '旅の同行者\n\n本文に出る詳しい説明',
    })
  })

  it('用語集を持たない作品では glossary キーが生えない', async () => {
    const { toBundleWork } = await loadModule()
    expect('glossary' in toBundleWork(work)).toBe(false)
  })

  it('送信本体にもローカル専用キーは載らない', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishWorkToPlatform(async () => 'jwt', {
      ...work,
      platform: { visibility: 'public', lastPublishedAt: 42 },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      schemaVersion: 2,
      work: { ...work, platform: { visibility: 'public' } },
    })
  })
})

describe('toBundleEpisodes（話ごとの公開状態・契約 v3）', () => {
  const withEpisodes: Work = {
    ...work,
    episodes: [
      { id: 'e1', title: '第一話', blocks: [] },
      { id: 'e2', title: '第二話', blocks: [] },
    ],
  }

  it('作品が公開なら全話ぶんを明示する（記録の無い話は公開）', async () => {
    const { toBundleEpisodes } = await loadModule()
    const { episodes, declared } = toBundleEpisodes({
      ...withEpisodes,
      platform: { visibility: 'public', episodeVisibility: { e2: 'draft' } },
    })

    expect(declared).toBe(true)
    expect(episodes.map((e) => e.visibility)).toEqual(['public', 'draft'])
  })

  it('作品が下書きなら話ごとの状態は載せない', async () => {
    // 作品より先に話が表へ出ることはない。言う意味の無い宣言は送らない
    const { toBundleEpisodes } = await loadModule()
    const { episodes, declared } = toBundleEpisodes({
      ...withEpisodes,
      platform: { visibility: 'draft', episodeVisibility: { e1: 'public' } },
    })

    expect(declared).toBe(false)
    expect(episodes.every((e) => !('visibility' in e))).toBe(true)
  })

  it('宣言を載せたときだけ schemaVersion 3 で送る', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishWorkToPlatform(async () => 'jwt', {
      ...withEpisodes,
      platform: { visibility: 'public', episodeVisibility: { e1: 'draft' } },
    })
    const [, published] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(published.body as string).schemaVersion).toBe(3)

    // 下書きのまま送る作品は v2 のまま。先方が v3 を知らない版でも本文の更新は通る
    await publishWorkToPlatform(async () => 'jwt', {
      ...withEpisodes,
      platform: { visibility: 'draft' },
    })
    const [, draft] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(draft.body as string).schemaVersion).toBe(2)
  })

  it('話ごとの記録そのものは platform キーには載せない（送り先は episodes 側）', async () => {
    const { toBundleWork } = await loadModule()
    const bundle = toBundleWork({
      ...withEpisodes,
      platform: { visibility: 'public', episodeVisibility: { e1: 'draft' } },
    })

    expect(bundle.platform).toEqual({ visibility: 'public' })
  })
})

describe('publishWorkToPlatform（v2 の公開結果）', () => {
  it('公開されたら published と読者ページの絶対URLを返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            created: false,
            episodesUpserted: 3,
            published: true,
            publishBlocked: null,
            manageUrl: '/dashboard/works/x/episodes',
            workUrl: '/works/x',
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(true)
      expect(result.publishBlocked).toBeNull()
      expect(result.workUrl).toBe(`${ORIGIN}/works/x`)
      expect(result.episodesUpserted).toBe(3)
    }
  })

  it('誓約が欠けていると、取り込み成功でも published=false と理由を返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            published: false,
            publishBlocked: 'declarations-missing',
            manageUrl: '/dashboard/works/x/episodes',
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(false)
      expect(result.publishBlocked).toBe('declarations-missing')
      // 公開されていないので読者ページの導線は出さない
      expect(result.workUrl).toBeUndefined()
    }
  })

  it('知らない理由コードは「阻まれていない」に倒す（先方の追加で壊れない）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, publishBlocked: 'unknown-reason' }), {
          status: 200,
        }),
      ),
    )

    const result = await publishWorkToPlatform(async () => 'jwt', work)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.publishBlocked).toBeNull()
  })

  it('v1 応答（published / workUrl 無し）でも壊れず未公開として扱う', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, created: true, manageUrl: '/dashboard' }), {
          status: 201,
        }),
      ),
    )

    const result = await publishWorkToPlatform(async () => 'jwt', work)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(false)
      expect(result.publishBlocked).toBeNull()
      expect(result.workUrl).toBeUndefined()
    }
  })
})

describe('契約 v4（サウンドノベル：episodes[].game）', () => {
  const publicWork = (): Work => ({
    id: 'w1',
    title: '作品',
    episodes: [
      { id: 'e1', title: '第一話', blocks: parseEpisodeBody('「おはよう」') },
      { id: 'e2', title: '第二話', blocks: [] },
    ],
    platform: {
      declaredAllAges: true,
      declaredOriginal: true,
      visibility: 'public',
      episodeVisibility: { e2: 'draft' },
      novelGameEpisodes: { e1: true },
    },
  })
  const novelGame = () => ({
    stagings: [
      { workId: 'w1', episodeId: 'e1', cues: [{ blockId: 'b1', speaker: '灯' }], updatedAt: 1 },
    ],
    gameAssets: [],
  })

  it('novelGame を渡すと公開話にだけ game(html) が付き、schemaVersion 4 で送る', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishWorkToPlatform(async () => 'jwt', publicWork(), novelGame())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(4)
    const [e1, e2] = body.work.episodes
    expect(e1.game?.v).toBe(1)
    expect(typeof e1.game?.html).toBe('string')
    // プレイヤーは自己完結（シナリオ・素材内包）で、フォントだけ配信側の契約パスを指す
    expect(e1.game.html).toContain('<!doctype html>')
    expect(e1.game.html).toContain('/game-assets/fonts/shippori-mincho-b1.woff2')
    expect(e1.game.html).toContain('data:image/svg+xml') // テンプレ背景は内包
    expect(e1.game.html).not.toContain('assets/bg/') // ファイル参照は残さない
    // 演出（話者）が反映されている
    expect(e1.game.html).toContain('灯')
    // 下書きの話には作らない（読者に出ない分で太らせない）
    expect(e2.visibility).toBe('draft')
    expect(e2.game).toBeUndefined()
  })

  it('選んでいない話はサウンドノベルにしない（演出を付けてあっても）', async () => {
    // 調整の途中で演出を付けただけの話が、黙って読者に出ないこと（D-GAME-EPISODE-PICK）
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    // e1 には演出譜あり。ただし話ごとの記録は無い＝作者はまだ選んでいない
    const work: Work = {
      ...publicWork(),
      episodes: [
        { id: 'e1', title: '第一話', blocks: parseEpisodeBody('「おはよう」') },
        { id: 'e3', title: '第三話', blocks: parseEpisodeBody('「こんばんは」') },
      ],
      platform: { declaredAllAges: true, declaredOriginal: true, visibility: 'public' },
    }
    await publishWorkToPlatform(async () => 'jwt', work, novelGame())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.work.episodes.every((ep: { game?: unknown }) => ep.game === undefined)).toBe(true)
    // それでも v4 で名乗る＝前に載せたぶんを先方が外せる
    expect(body.schemaVersion).toBe(4)
  })

  it('演出の無い話でも、選べばサウンドノベルになる', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    // 演出のある e1 を外し、演出の無い e3 を選ぶ（対象は作者の指定だけで決まる）
    const work: Work = {
      ...publicWork(),
      episodes: [
        { id: 'e1', title: '第一話', blocks: parseEpisodeBody('「おはよう」') },
        { id: 'e3', title: '第三話', blocks: parseEpisodeBody('「こんばんは」') },
      ],
      platform: {
        declaredAllAges: true,
        declaredOriginal: true,
        visibility: 'public',
        novelGameEpisodes: { e1: false, e3: true },
      },
    }
    await publishWorkToPlatform(async () => 'jwt', work, novelGame())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    const [e1, e3] = body.work.episodes
    expect(e1.game).toBeUndefined()
    expect(e3.game?.v).toBe(1)
    // 1話も載らなくなる形でも v4 は名乗る（先方が外したぶんを消せるように）
    expect(body.schemaVersion).toBe(4)
    // 話ごとの記録はローカル専用。契約に無いキーは送らない
    expect(body.work.platform).not.toHaveProperty('novelGameEpisodes')
  })

  it('novelGame を渡さなければ従来どおり（v3 のまま・game は付かない）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishWorkToPlatform(async () => 'jwt', publicWork())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(3)
    expect(body.work.episodes.every((ep: { game?: unknown }) => ep.game === undefined)).toBe(true)
  })

  it('enabled:false は v4 のまま game 無しで送る（前回の同梱を先方に消してもらう宣言）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishWorkToPlatform(async () => 'jwt', publicWork(), {
      stagings: [],
      gameAssets: [],
      enabled: false,
    })

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(4)
    expect(body.work.episodes.every((ep: { game?: unknown }) => ep.game === undefined)).toBe(true)
  })

  it('enabled:false は作品を下書きへ戻す送信でも v4 で届く（OFF が先方に伝わる）', async () => {
    // ここで v2 に落とすと先方は据え置き＝OFF のまま再公開したとき古いプレイヤーが復活する
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const draft: Work = { ...publicWork(), platform: { visibility: 'draft' } }
    await publishWorkToPlatform(async () => 'jwt', draft, {
      stagings: [],
      gameAssets: [],
      enabled: false,
    })

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(4)
    expect(body.work.episodes.every((ep: { game?: unknown }) => ep.game === undefined)).toBe(true)
  })

  it('下書き作品では novelGame を渡しても game は付かない（v2 のまま）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const draft: Work = { ...publicWork(), platform: { visibility: 'draft' } }
    await publishWorkToPlatform(async () => 'jwt', draft, novelGame())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(2)
    expect(body.work.episodes.every((ep: { game?: unknown }) => ep.game === undefined)).toBe(true)
  })
})

describe('契約 v5（素材は作品ぶん1回だけ・話は asset:<id> で参照）', () => {
  const dataUrl = 'data:image/webp;base64,SGkh'
  const asset = {
    id: 'a1',
    kind: 'sprite' as const,
    name: '灯（通常）',
    dataUrl,
    tone: ['#111111', '#222222', '#333333'] as [string, string, string],
    character: '灯',
    expression: '通常',
    createdAt: 1,
  }
  const twoEpisodeWork = (): Work => ({
    id: 'w1',
    title: '作品',
    episodes: [
      { id: 'e1', title: '第一話', blocks: parseEpisodeBody('「おはよう」') },
      { id: 'e2', title: '第二話', blocks: parseEpisodeBody('「こんばんは」') },
    ],
    platform: {
      declaredAllAges: true,
      declaredOriginal: true,
      visibility: 'public',
      novelGameEpisodes: { e1: true, e2: true },
    },
  })
  const novelGame = () => ({
    stagings: [
      { workId: 'w1', episodeId: 'e1', cues: [{ blockId: 'b1', speaker: '灯' }], updatedAt: 1 },
      { workId: 'w1', episodeId: 'e2', cues: [{ blockId: 'b1', speaker: '灯' }], updatedAt: 1 },
    ],
    gameAssets: [asset],
  })

  it('同じ立ち絵を使う2話でも、実体は1回だけ送る（話は参照だけを持つ）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishWorkToPlatform(async () => 'jwt', twoEpisodeWork(), novelGame())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(5)
    // 実体は作品ぶんに 1 つだけ
    expect(body.work.gameAssets).toEqual([{ id: 'a1', dataUrl }])
    for (const ep of body.work.episodes) {
      expect(ep.game.v).toBe(2)
      expect(ep.game.assets).toEqual(['a1'])
      // 話の HTML は参照だけ＝実体を話数ぶん送り直さない
      expect(ep.game.html).toContain('asset:a1')
      expect(ep.game.html).not.toContain(dataUrl)
    }
  })

  it('効果音の音声（運営テンプレ）を載せるときだけ v6 を名乗る', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const se = {
      id: 'tpl-se-weather-rain',
      kind: 'se' as const,
      name: '雨（強）',
      dataUrl: 'data:audio/mpeg;base64,SUQz',
      tone: ['#000000', '#000000', '#000000'] as [string, string, string],
      preset: 'preset:se/weather-rain',
      createdAt: 1,
    }
    await publishWorkToPlatform(async () => 'jwt', twoEpisodeWork(), {
      stagings: [
        {
          workId: 'w1',
          episodeId: 'e1',
          cues: [{ blockId: 'b1', se: 'preset:se/weather-rain', seRepeat: 'loop' }],
          updatedAt: 1,
        },
      ],
      gameAssets: [asset, se],
    })

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(6)
    // 使った素材だけ（立ち絵は話者が無いので載らない）
    expect(body.work.gameAssets).toEqual([{ id: 'tpl-se-weather-rain', dataUrl: se.dataUrl }])
    expect(body.work.episodes[0].game.assets).toEqual(['tpl-se-weather-rain'])
    expect(body.work.episodes[0].game.html).toContain('asset:tpl-se-weather-rain')
  })

  it('先方が v5 までしか知らないときは、効果音を外せば通ると案内する', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'unsupported-schema-version', supported: 5 }), {
          status: 409,
        }),
      ),
    )
    const res = await publishWorkToPlatform(async () => 'jwt', twoEpisodeWork(), novelGame())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toContain('効果音')
  })

  it('持ち込み素材を使わない作品は v4 のまま（使わない版は名乗らない）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    // 演出はあるが持ち込み素材は 1 枚も使っていない（テンプレだけ）
    await publishWorkToPlatform(async () => 'jwt', twoEpisodeWork(), {
      stagings: novelGame().stagings,
      gameAssets: [],
    })

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.schemaVersion).toBe(4)
    expect(body.work).not.toHaveProperty('gameAssets')
    expect(body.work.episodes[0].game.v).toBe(1)
  })

  it('使っていない素材は送らない（手元にあるだけの分で太らせない）', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const unused = { ...asset, id: 'a2', character: '出番の無い人' }
    await publishWorkToPlatform(async () => 'jwt', twoEpisodeWork(), {
      stagings: novelGame().stagings,
      gameAssets: [asset, unused],
    })

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.work.gameAssets).toEqual([{ id: 'a1', dataUrl }])
  })
})

describe('canPublishPublicly / describePublishBlocked（公開可否の判定）', () => {
  it('誓約が2つとも揃ったときだけ公開して投稿できる', async () => {
    const { canPublishPublicly } = await loadModule()
    expect(canPublishPublicly({ declaredAllAges: true, declaredOriginal: true })).toBe(true)
    expect(canPublishPublicly({ declaredAllAges: true, declaredOriginal: false })).toBe(false)
    expect(canPublishPublicly({ declaredOriginal: true })).toBe(false)
    expect(canPublishPublicly({})).toBe(false)
    expect(canPublishPublicly(undefined)).toBe(false)
  })

  it('阻まれた理由を、何をすればよいか分かる日本語にする', async () => {
    const { describePublishBlocked } = await loadModule()
    expect(describePublishBlocked('declarations-missing')).toContain('誓約')
    expect(describePublishBlocked('moderated')).toContain('運営')
  })
})
