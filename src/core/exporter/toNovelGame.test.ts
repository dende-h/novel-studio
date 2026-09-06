import { describe, expect, it, vi } from 'vitest'
import { applyCues, type Staging, toPages } from '../game'
import { resolveContinuity } from '../game/continuity'
import { DEFAULT_BG_KEY } from '../game/presets'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode, Work } from '../schema'
import type { GameScenario } from './novelGamePlayer'
import { buildNovelGameFiles, buildNovelGamePlayer, unitsOfInlines } from './toNovelGame'

// この版は効果音を隠している（features.ts）。書き出しの効果音経路そのものはここで検証し続ける。
// フラグが落ちているときの振る舞いは toNovelGame.features.test.ts
vi.mock('../game/features', () => ({ GAME_FEATURES: { se: true } }))

const episode: Episode = {
  id: 'e1',
  title: '第一話　雨の夜',
  blocks: parseEpisodeBody('　雨は夜半から強くなった。\n\n「——まだ、書いてるんだね」'),
}

const work: Work = {
  id: 'w1',
  title: '夜の物語',
  author: '灯',
  episodes: [episode],
}

const staging = (cues: Staging['cues']): Staging => ({
  workId: 'w1',
  episodeId: 'e1',
  cues,
  updatedAt: 0,
})

/** 生成された index.html からシナリオ JSON を取り出す（プレイヤーと同じ読み方）。 */
function scenarioOf(files: { path: string; data: string | Uint8Array }[]): GameScenario {
  const html = files.find((f) => f.path === 'index.html')?.data
  if (typeof html !== 'string') throw new Error('index.html が無い')
  const m = /<script id="scenario" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m?.[1]) throw new Error('シナリオ JSON が無い')
  return JSON.parse(m[1]) as GameScenario
}

describe('buildNovelGameFiles（zip の中身）', () => {
  it('Staging なしでも index.html・readme・既定背景が揃う（演出ゼロでプレイできる）', () => {
    const files = buildNovelGameFiles(work, episode, undefined)
    const paths = files.map((f) => f.path)
    expect(paths).toContain('index.html')
    expect(paths).toContain('readme.txt')
    expect(paths).toContain('assets/bg/sky-night.svg')
  })

  it('シナリオはページ・話者なし・既定背景・セーブキーを持つ', () => {
    const s = scenarioOf(buildNovelGameFiles(work, episode, undefined))
    expect(s.pages).toHaveLength(2)
    expect(s.pages[0]?.kind).toBe('narration')
    expect(s.pages[1]?.kind).toBe('dialogue')
    expect(s.pages[1]?.beat).toBe(1)
    expect(s.pages[0]?.bg).toBe(DEFAULT_BG_KEY)
    expect(s.saveKey).toBe('kotonoha:novel-game:w1:e1')
    expect(s.workTitle).toBe('夜の物語')
  })

  it('正本（work / episode）を書き換えない', () => {
    const before = JSON.stringify({ work, episode })
    buildNovelGameFiles(work, episode, staging([{ blockId: 'b1', bg: 'preset:bg/room-night' }]))
    expect(JSON.stringify({ work, episode })).toBe(before)
  })

  it('cue の背景切り替えが載り、使った背景だけが同梱される', () => {
    const files = buildNovelGameFiles(
      work,
      episode,
      staging([{ blockId: 'b3', bg: 'preset:bg/room-night', transition: 'fade' }]),
      { defaultBg: 'preset:bg/road-night' },
    )
    const s = scenarioOf(files)
    expect(s.pages[0]?.bg).toBe('preset:bg/road-night')
    expect(s.pages[1]?.bg).toBe('preset:bg/room-night')
    expect(s.pages[1]?.transition).toBe('fade')
    const paths = files.map((f) => f.path)
    expect(paths).toContain('assets/bg/road-night.svg')
    expect(paths).toContain('assets/bg/room-night.svg')
    expect(paths).not.toContain('assets/bg/sky-night.svg')
  })

  it('未知の背景キー（user:* 等）は無視して壊さない', () => {
    const files = buildNovelGameFiles(work, episode, staging([{ blockId: 'b3', bg: 'user:abc' }]))
    const s = scenarioOf(files)
    expect(s.pages[1]?.bg).toBeUndefined()
    // 参照キーに対応する実体は全て同梱される（不変条件）
    for (const key of Object.keys(s.bgs)) {
      expect(files.map((f) => f.path)).toContain(s.bgs[key]?.src)
    }
  })

  it('話者 cue がシナリオへ載る', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, episode, staging([{ blockId: 'b3', speaker: '灯' }])),
    )
    expect(s.pages[1]?.speaker).toBe('灯')
  })

  it('未知の defaultBg は既定背景に倒す', () => {
    const s = scenarioOf(buildNovelGameFiles(work, episode, undefined, { defaultBg: 'user:zzz' }))
    expect(s.defaultBg).toBe(DEFAULT_BG_KEY)
  })

  it('フォントを渡すと woff2 と LICENSE が同梱され、クレジットにフォント行が入る', () => {
    const files = buildNovelGameFiles(work, episode, undefined, {
      font: { data: new Uint8Array([1, 2, 3]), licenseText: 'OFL...' },
    })
    const paths = files.map((f) => f.path)
    expect(paths).toContain('assets/fonts/shippori-mincho-b1.woff2')
    expect(paths).toContain('assets/fonts/LICENSE.txt')
    const s = scenarioOf(files)
    expect(s.fontSrc).toBe('assets/fonts/shippori-mincho-b1.woff2')
    expect(s.credits.some((c) => c.label === 'フォント')).toBe(true)
  })

  it('フォント無しでも書き出せて、クレジットにフォント行は入らない', () => {
    const s = scenarioOf(buildNovelGameFiles(work, episode, undefined))
    expect(s.fontSrc).toBeUndefined()
    expect(s.credits.some((c) => c.label === 'フォント')).toBe(false)
  })

  it('クレジットは使った背景のラベルから機械的に生成される', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, episode, staging([{ blockId: 'b3', bg: 'preset:bg/room-night' }])),
    )
    const bg = s.credits.find((c) => c.label === '背景')
    expect(bg?.body).toContain('空（夜）')
    expect(bg?.body).toContain('室内（夜）')
  })

  it('本文の HTML はエスケープされ、JSON はタグ脱出できない形で埋まる', () => {
    const evil: Episode = {
      id: 'e2',
      title: 'x</script><script>alert(1)</script>',
      blocks: parseEpisodeBody('<script>alert("x")</script>と書いた。'),
    }
    const files = buildNovelGameFiles(work, evil, undefined)
    const html = files.find((f) => f.path === 'index.html')?.data as string
    // シナリオ JSON 内の < は < 化される＝生の </script> が本文由来で現れない
    expect(html.match(/<\/script>/g)?.length).toBe(3) // 素材・シナリオ・プレイヤー本体のみ
    const s = scenarioOf(files)
    expect(s.pages[0]?.text).toContain('<script>')
    const joined = s.pages[0]?.units.map((u) => (typeof u === 'string' ? u : u[0])).join('')
    expect(joined).toContain('&lt;script&gt;')
    expect(joined).not.toContain('<script>')
  })
})

describe('unitsOfInlines（文字送りの1コマ列）', () => {
  it('ルビは1コマ・純文字は親文字になる', () => {
    const [block] = parseEpisodeBody('｜灯《あかり》です')
    const units = unitsOfInlines(block?.inlines ?? [])
    expect(units[0]).toEqual(['<ruby>灯<rp>（</rp><rt>あかり</rt><rp>）</rp></ruby>', '灯'])
    expect(units.slice(1)).toEqual(['で', 'す'])
  })

  it('傍点は1文字ずつ点付きのコマになる', () => {
    const [block] = parseEpisodeBody('《《ここ》》だ')
    const units = unitsOfInlines(block?.inlines ?? [])
    expect(units[0]).toEqual(['<em class="dots">こ</em>', 'こ'])
    expect(units[2]).toBe('だ')
  })

  it('参照は名前のプレーン文字へ落ちる（リンク化しない）', () => {
    const [block] = parseEpisodeBody('[[灯]]よ')
    const units = unitsOfInlines(block?.inlines ?? [])
    expect(units).toEqual(['灯', 'よ'])
  })

  it('サロゲートペア（絵文字等）を割らない', () => {
    const [block] = parseEpisodeBody('👍だ')
    const units = unitsOfInlines(block?.inlines ?? [])
    expect(units[0]).toBe('👍')
  })
})

describe('持ち込み背景（user:* の同梱）', () => {
  const userAsset = {
    key: 'user:abc123',
    id: 'abc123',
    label: '自作の教室',
    tone: ['#111111', '#222222', '#333333'] as [string, string, string],
    mime: 'image/webp',
    data: new Uint8Array([9, 9, 9]),
  }

  it('cue が指す持ち込み背景が zip とシナリオに載り、クレジットには載らない', () => {
    const files = buildNovelGameFiles(
      work,
      episode,
      staging([{ blockId: 'b3', bg: 'user:abc123' }]),
      { userAssets: [userAsset] },
    )
    const s = scenarioOf(files)
    expect(s.pages[1]?.bg).toBe('user:abc123')
    expect(s.bgs['user:abc123']).toEqual({
      src: 'assets/bg/user-abc123.webp',
      label: '自作の教室',
      tone: ['#111111', '#222222', '#333333'],
    })
    const file = files.find((f) => f.path === 'assets/bg/user-abc123.webp')
    expect(file?.data).toBeInstanceOf(Uint8Array)
    // 持ち込みは作者自身の素材＝クレジット（運営素材の一覧）に載せない
    expect(s.credits.find((c) => c.label === '背景')?.body).not.toContain('自作の教室')
  })

  it('手元に無い user:* キーは従来どおり無視される', () => {
    const files = buildNovelGameFiles(work, episode, staging([{ blockId: 'b3', bg: 'user:zzz' }]), {
      userAssets: [userAsset],
    })
    const s = scenarioOf(files)
    expect(s.pages[1]?.bg).toBeUndefined()
    expect(files.some((f) => f.path.includes('user-'))).toBe(false)
  })

  it('渡しても使われていない持ち込み素材は同梱しない', () => {
    const files = buildNovelGameFiles(work, episode, undefined, { userAssets: [userAsset] })
    expect(files.some((f) => f.path.includes('user-'))).toBe(false)
  })

  it('defaultBg に持ち込み背景を指定できる', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, episode, undefined, {
        defaultBg: 'user:abc123',
        userAssets: [userAsset],
      }),
    )
    expect(s.defaultBg).toBe('user:abc123')
    expect(s.pages[0]?.bg).toBe('user:abc123')
  })
})

describe('立ち絵（席ごとの指示・話者とは独立・3 人まで）', () => {
  // b1=セリフ / b2=地の文 / b3=セリフ / b4=セリフ / b5=地の文
  const spriteEpisode: Episode = {
    id: 'e9',
    title: '立ち絵の話',
    blocks: parseEpisodeBody(
      '「おはよう」\n　朝だった。\n「……行こうか」\n「はい」\n　二人は歩き出した。',
    ),
  }
  const tone = ['#111111', '#222222', '#333333'] as [string, string, string]
  const sprite = (id: string, character: string, expression: string, createdAt: number) => ({
    key: `user:${id}`,
    id,
    label: `${character}（${expression}）`,
    tone,
    mime: 'image/webp' as const,
    data: new Uint8Array([7]),
    kind: 'sprite' as const,
    character,
    expression,
    createdAt,
  })
  const akariNormal = sprite('ak-n', '灯', '通常', 1)
  const akariSmile = sprite('ak-s', '灯', '笑顔', 2)
  const beni = sprite('be-n', 'ベニ', '通常', 3)
  const saku = sprite('sa-n', 'サク', '通常', 4)
  const opts = { userAssets: [akariNormal, akariSmile, beni, saku] }

  it('話者は立ち絵を呼ばない。席の指示で立ち、話者と同じ人物なら明るい', () => {
    const only = scenarioOf(
      buildNovelGameFiles(work, spriteEpisode, staging([{ blockId: 'b1', speaker: '灯' }]), opts),
    )
    expect(only.pages.every((p) => p.stage === undefined)).toBe(true)
    expect(only.sprites).toBeUndefined()

    const files = buildNovelGameFiles(
      work,
      spriteEpisode,
      staging([{ blockId: 'b1', speaker: '灯', sprites: [{ pos: 'c', character: '灯' }] }]),
      opts,
    )
    const s = scenarioOf(files)
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
    expect(s.pages[1]?.stage).toBeUndefined() // 据え置き（マーカー無し）
    expect(s.sprites?.['user:ak-n']).toEqual({
      src: 'assets/sprite/user-ak-n.webp',
      label: '灯（通常）',
    })
    const paths = files.map((f) => f.path)
    expect(paths).toContain('assets/sprite/user-ak-n.webp')
    expect(paths).not.toContain('assets/sprite/user-be-n.webp') // 未使用は同梱しない
    const html = files.find((f) => f.path === 'index.html')?.data as string
    expect(html).toContain('id="sprites"')
  })

  it('話者が舞台にいなければ誰も明るくしない（全員ふつうの明るさ）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([{ blockId: 'b1', speaker: 'ベニ', sprites: [{ pos: 'c', character: '灯' }] }]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c' }])
  })

  it('表情は席の指示で差し替わる（席はそのまま）。省略すればいまの表情のまま', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', sprites: [{ pos: 'c', character: '灯', expression: '笑顔' }] },
          { blockId: 'b3', speaker: '灯', sprites: [{ pos: 'c', character: '灯' }] }, // 表情は据え置き
          { blockId: 'b4', sprites: [{ character: '灯', expression: '通常' }] }, // 席の省略＝差し替えだけ
        ]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-s', p: 'c' }])
    expect(s.pages[2]?.stage).toEqual([{ k: 'user:ak-s', p: 'c', a: 1 }])
    // 話者の無いセリフでは明るさは据え置き（ちらつかせない）
    expect(s.pages[3]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
  })

  it('席は 3 つ（左・中央・右）。舞台は席順に並び、下げるのはその席だけ', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          {
            blockId: 'b1',
            sprites: [
              { pos: 'r', character: 'サク' },
              { pos: 'l', character: '灯' },
              { pos: 'c', character: 'ベニ' },
            ],
          },
          { blockId: 'b3', speaker: 'ベニ' }, // 話者は席を動かさず、明るくするだけ
          { blockId: 'b4', sprites: [{ pos: 'l' }] }, // 左だけ下げる
        ]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([
      { k: 'user:ak-n', p: 'l' },
      { k: 'user:be-n', p: 'c' },
      { k: 'user:sa-n', p: 'r' },
    ])
    expect(s.pages[2]?.stage).toEqual([
      { k: 'user:ak-n', p: 'l' },
      { k: 'user:be-n', p: 'c', a: 1 },
      { k: 'user:sa-n', p: 'r' },
    ])
    expect(s.pages[3]?.stage).toEqual([
      { k: 'user:be-n', p: 'c', a: 1 }, // 話者の無い行＝明るさは据え置き
      { k: 'user:sa-n', p: 'r' },
    ])
  })

  it('席を省略すると空いている席（中央→左→右）へ。同じ人物を別の席に指せば移る', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', sprites: [{ character: '灯' }] },
          { blockId: 'b2', sprites: [{ character: 'ベニ' }] },
          { blockId: 'b3', sprites: [{ pos: 'r', character: '灯' }] },
        ]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c' }])
    expect(s.pages[1]?.stage).toEqual([
      { k: 'user:be-n', p: 'l' },
      { k: 'user:ak-n', p: 'c' },
    ])
    expect(s.pages[2]?.stage).toEqual([
      { k: 'user:be-n', p: 'l' },
      { k: 'user:ak-n', p: 'r' },
    ])
  })

  it('話者が替われば明るい人物も替わる。？？？や立ち絵の無い話者では全員ふつうの明るさ', () => {
    const base = [
      {
        blockId: 'b1',
        speaker: '灯',
        sprites: [
          { pos: 'l', character: '灯' },
          { pos: 'r', character: 'ベニ' },
        ],
      },
      { blockId: 'b3', speaker: 'ベニ' },
    ]
    for (const third of [
      { blockId: 'b4', speaker: '？？？' },
      { blockId: 'b4', speaker: 'モブ' },
    ]) {
      const s = scenarioOf(
        buildNovelGameFiles(work, spriteEpisode, staging([...base, third]), opts),
      )
      expect(s.pages[0]?.stage).toEqual([
        { k: 'user:ak-n', p: 'l', a: 1 },
        { k: 'user:be-n', p: 'r' },
      ])
      expect(s.pages[2]?.stage).toEqual([
        { k: 'user:ak-n', p: 'l' },
        { k: 'user:be-n', p: 'r', a: 1 },
      ])
      expect(s.pages[3]?.stage).toEqual([
        { k: 'user:ak-n', p: 'l' },
        { k: 'user:be-n', p: 'r' },
      ])
    }
  })

  it('場面の切れ目（sceneBreak）で全員退場する', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', sprites: [{ character: '灯' }] },
          { blockId: 'b5', sceneBreak: true },
        ]),
        opts,
      ),
    )
    expect(s.pages[4]?.stage).toEqual([])
  })

  it('立ち絵が無ければシナリオは従来のまま（sprites も stage マーカーも出ない）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([{ blockId: 'b1', speaker: '灯', sprites: [{ character: '灯' }] }]),
      ),
    )
    expect(s.sprites).toBeUndefined()
    expect(s.pages.every((p) => p.stage === undefined)).toBe(true)
  })

  it('立ち絵のキーは背景として解決されない（cue.bg が指しても無視）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, spriteEpisode, staging([{ blockId: 'b2', bg: 'user:ak-n' }]), opts),
    )
    expect(s.pages[1]?.bg).toBeUndefined()
  })

  it('立ち絵の無い人物・？？？の指示は無視して壊さない', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', sprites: [{ character: '灯' }] },
          { blockId: 'b2', sprites: [{ pos: 'l', character: 'モブ' }] },
          { blockId: 'b3', sprites: [{ pos: 'r', character: '？？？' }] },
        ]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c' }])
    expect(s.pages[1]?.stage).toBeUndefined()
    expect(s.pages[2]?.stage).toBeUndefined()
  })

  it('旧式の登場（appear）と表情（expression）も読める（空いている席へ・話者の表情差し替え）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b2', appear: '灯', expression: '笑顔' }, // 旧式：地の文で登場
          { blockId: 'b3', speaker: '灯' }, // 話す＝明るく（席はそのまま）
          { blockId: 'b4', speaker: '灯', expression: '通常' }, // 旧式：話者の表情差し替え
        ]),
        opts,
      ),
    )
    expect(s.pages[1]?.stage).toEqual([{ k: 'user:ak-s', p: 'c' }])
    expect(s.pages[2]?.stage).toEqual([{ k: 'user:ak-s', p: 'c', a: 1 }])
    expect(s.pages[3]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
  })

  it('画面が説明する「効いているもの」と、書き出す中身が一致する（ずれの見張り）', () => {
    // 演出エディタの続きレーンは resolveContinuity で描く。ここがずれると画面が嘘をつく
    const cues = [
      {
        blockId: 'b1',
        speaker: '灯',
        bg: 'preset:bg/town-night',
        sprites: [{ pos: 'l' as const, character: '灯' }],
      },
      {
        blockId: 'b2',
        sprites: [{ character: 'ベニ' }],
        se: 'preset:se/rain',
        seRepeat: 'loop' as const,
      },
      { blockId: 'b3', speaker: 'ベニ', sprites: [{ pos: 'r' as const, character: 'サク' }] },
      { blockId: 'b4', hideSprite: true },
      { blockId: 'b5', sceneBreak: true, bg: 'preset:bg/room-night' },
    ]
    const s = scenarioOf(buildNovelGameFiles(work, spriteEpisode, staging(cues), opts))
    const continuity = resolveContinuity(applyCues(toPages(spriteEpisode.blocks), staging(cues)), {
      hasSprite: (name) => opts.userAssets.some((a) => a.character === name),
    })
    const charOf = new Map(opts.userAssets.map((a) => [a.key, a.character]))

    let bg = ''
    let stage: string[] = []
    s.pages.forEach((page, i) => {
      if (page.bg) bg = page.bg
      if (page.stage) stage = page.stage.map((e) => `${e.p}:${charOf.get(e.k) ?? e.k}`)
      expect(bg).toBe(continuity[i]?.bg)
      expect(stage).toEqual(continuity[i]?.seats.map((x) => `${x.pos}:${x.character}`))
    })
  })

  it('立ち絵を出さない（hideSprite）：舞台を空にし、次の場面の切れ目まで出さない', () => {
    // 人物ごと描いた一枚絵の背景に立ち絵が重なるのを止める欄（D-GAME-SPRITE-OFF）
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯', sprites: [{ character: '灯' }] }, // 立つ
          { blockId: 'b2', hideSprite: true }, // 地の文で下ろす
          { blockId: 'b3', speaker: '灯' }, // 話しても出さない
          { blockId: 'b4', sceneBreak: true, speaker: '灯', sprites: [{ character: '灯' }] }, // 場面が変わって出し直す
        ]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
    expect(s.pages[1]?.stage).toEqual([]) // 舞台を空にする
    expect(s.pages[2]?.stage).toBeUndefined() // 空のまま（据え置き）
    // 名前枠は出る＝「誰が喋ったか」は消さない
    expect(s.pages[2]?.speaker).toBe('灯')
    expect(s.pages[3]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
  })

  it('立ち絵を出さない区間でも、席の指示があればその場で戻る', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', sprites: [{ character: '灯' }] },
          { blockId: 'b2', hideSprite: true },
          { blockId: 'b5', sprites: [{ character: '灯' }] }, // 同じ場面のまま出し直す
        ]),
        opts,
      ),
    )
    expect(s.pages[1]?.stage).toEqual([])
    expect(s.pages[4]?.stage).toEqual([{ k: 'user:ak-n', p: 'c' }])
  })
})

describe('効果音の鳴らし方（1回・2回・ずっと）', () => {
  const ep: Episode = {
    id: 'e9',
    title: '音の話',
    blocks: parseEpisodeBody('　雨が降りはじめた。\n「——行こうか」\n　やがて、雨はやんだ。'),
  }
  const work: Work = { id: 'w1', title: '作品', episodes: [ep] }

  it('鳴らし方をページへ載せる（省略は1回＝載せない）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, ep, {
        workId: 'w1',
        episodeId: 'e9',
        cues: [
          { blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' },
          { blockId: 'b2', se: 'preset:se/knock', seRepeat: 2 },
          { blockId: 'b3', se: 'preset:se/bell' },
        ],
        updatedAt: 1,
      }),
    )
    expect(s.pages[0]?.se).toBe('preset:se/rain')
    expect(s.pages[0]?.seRepeat).toBe('loop')
    expect(s.pages[1]?.seRepeat).toBe(2)
    expect(s.pages[2]?.se).toBe('preset:se/bell')
    expect(s.pages[2]?.seRepeat).toBeUndefined()
  })

  it('「止める」はレシピを持たないが、ページには載る（ループを終わらせる合図）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, ep, {
        workId: 'w1',
        episodeId: 'e9',
        cues: [
          { blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' },
          { blockId: 'b3', se: 'stop' },
        ],
        updatedAt: 1,
      }),
    )
    expect(s.pages[2]?.se).toBe('stop')
    // 同梱するレシピは雨だけ（stop は実体を持たない）
    expect(Object.keys(s.ses ?? {})).toEqual(['preset:se/rain'])
  })
})

describe('プレビュー（startAt）', () => {
  const ep: Episode = {
    id: 'e9',
    title: 'プレビューの話',
    blocks: parseEpisodeBody('「おはよう」\n　朝だった。\n「……行こうか」'),
  }
  const work: Work = { id: 'w1', title: '作品', episodes: [ep] }

  it('startAt を渡すとシナリオに start が載る（その行から始まる）', () => {
    const s = scenarioOf(buildNovelGameFiles(work, ep, undefined, { startAt: 2 }))
    expect(s.start).toBe(2)
  })

  it('書き出し・投稿では載らない（読者はタイトル画面から始める）', () => {
    const s = scenarioOf(buildNovelGameFiles(work, ep, undefined))
    expect(s.start).toBeUndefined()
  })
})

describe('テンプレ立ち絵（シルエット・preset）', () => {
  const tplAsset = {
    key: 'user:tpl-1',
    id: 'tpl-1',
    label: '灯（シルエット（女性））',
    tone: ['#2E3850', '#222A3E', '#161C2B'] as [string, string, string],
    mime: 'image/svg+xml',
    data: new Uint8Array([60, 115, 118, 103]),
    kind: 'sprite' as const,
    character: '灯',
    expression: '通常',
    preset: 'preset:sprite/silhouette-woman',
    createdAt: 1,
  }
  const ep: Episode = {
    id: 'e9',
    title: 'テンプレの話',
    blocks: parseEpisodeBody('「おはよう」'),
  }

  it('svg のまま同梱され、クレジットに運営素材として載る', () => {
    const files = buildNovelGameFiles(
      work,
      ep,
      staging([{ blockId: 'b1', speaker: '灯', sprites: [{ character: '灯' }] }]),
      { userAssets: [tplAsset] },
    )
    const s = scenarioOf(files)
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:tpl-1', p: 'c', a: 1 }])
    expect(s.sprites?.['user:tpl-1']?.src).toBe('assets/sprite/user-tpl-1.svg')
    expect(files.some((f) => f.path === 'assets/sprite/user-tpl-1.svg')).toBe(true)
    const credit = s.credits.find((c) => c.label === '立ち絵')
    expect(credit?.body).toContain('シルエット（女性）')
  })

  it('効果音（cue.se）はページに載り、使ったレシピだけ ses に同梱・クレジットにも載る', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, ep, staging([{ blockId: 'b1', se: 'preset:se/bell' }])),
    )
    expect(s.pages[0]?.se).toBe('preset:se/bell')
    expect(s.ses?.['preset:se/bell']?.label).toBe('鐘')
    expect(s.ses?.['preset:se/bell']?.steps?.length).toBeGreaterThan(0)
    expect(Object.keys(s.ses ?? {})).toEqual(['preset:se/bell'])
    expect(s.credits.find((c) => c.label === '効果音')?.body).toContain('鐘')
    // 未知キーは無視して壊さない（ses も出ない）
    const s2 = scenarioOf(buildNovelGameFiles(work, ep, staging([{ blockId: 'b1', se: 'zzz' }])))
    expect(s2.pages[0]?.se).toBeUndefined()
    expect(s2.ses).toBeUndefined()
    expect(s2.credits.some((c) => c.label === '効果音')).toBe(false)
  })

  it('持ち込みの立ち絵はクレジットに載らない', () => {
    const own = { ...tplAsset, key: 'user:own-1', id: 'own-1', preset: undefined }
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        ep,
        staging([{ blockId: 'b1', speaker: '灯', sprites: [{ character: '灯' }] }]),
        { userAssets: [own] },
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:own-1', p: 'c', a: 1 }])
    expect(s.credits.some((c) => c.label === '立ち絵')).toBe(false)
  })
})

describe('テンプレ背景の画像（目録から取った実体・preset 付きの素材）', () => {
  const roomDay = {
    key: 'preset:bg/room-day',
    id: 'tpl-bg-room-day',
    label: '室内（昼）',
    tone: ['#aaaaaa', '#bbbbbb', '#cccccc'] as [string, string, string],
    mime: 'image/webp',
    data: new Uint8Array([82, 73, 70, 70]),
    kind: 'bg' as const,
    preset: 'preset:bg/room-day',
    dataUrl: 'data:image/webp;base64,UklGRg==',
  }

  it('同じキーの組み込み SVG より画像が優先され、zip には <slug>.webp で入る', () => {
    const files = buildNovelGameFiles(
      work,
      episode,
      staging([{ blockId: 'b3', bg: 'preset:bg/room-day' }]),
      { userAssets: [roomDay] },
    )
    const s = scenarioOf(files)
    expect(s.bgs['preset:bg/room-day']).toEqual({
      src: 'assets/bg/room-day.webp',
      label: '室内（昼）',
      tone: ['#aaaaaa', '#bbbbbb', '#cccccc'],
    })
    expect(files.some((f) => f.path === 'assets/bg/room-day.webp')).toBe(true)
    expect(files.some((f) => f.path === 'assets/bg/room-day.svg')).toBe(false)
    // 運営素材なのでクレジットに載る
    expect(s.credits.find((c) => c.label === '背景')?.body).toContain('室内（昼）')
  })

  it('画像が渡されなければ今までどおり組み込み SVG（旧作品の控え）', () => {
    const files = buildNovelGameFiles(
      work,
      episode,
      staging([{ blockId: 'b3', bg: 'preset:bg/room-day' }]),
    )
    expect(files.some((f) => f.path === 'assets/bg/room-day.svg')).toBe(true)
  })

  it('契約 v5：話の HTML は asset:<id> で参照し、その id が作品ぶんの素材として拾われる', () => {
    const asset = {
      id: 'tpl-bg-room-day',
      kind: 'bg' as const,
      name: '室内（昼）',
      dataUrl: 'data:image/webp;base64,UklGRg==',
      tone: ['#aaaaaa', '#bbbbbb', '#cccccc'] as [string, string, string],
      preset: 'preset:bg/room-day',
      createdAt: 1,
    }
    const { html, assetIds } = buildNovelGamePlayer(
      work,
      episode,
      staging([{ blockId: 'b3', bg: 'preset:bg/room-day' }]),
      { gameAssets: [asset] },
    )
    expect(assetIds).toEqual(['tpl-bg-room-day'])
    const s = scenarioOf([{ path: 'index.html', data: html }])
    expect(s.bgs['preset:bg/room-day']?.src).toBe('asset:tpl-bg-room-day')
  })
})

describe('効果音の音声ファイル（目録の実体・preset 付きの素材）', () => {
  const rainFile = {
    key: 'preset:se/weather-rain',
    id: 'tpl-se-weather-rain',
    label: '雨（強）',
    tone: ['#000000', '#000000', '#000000'] as [string, string, string],
    mime: 'audio/mpeg',
    data: new Uint8Array([73, 68, 51]),
    kind: 'se' as const,
    preset: 'preset:se/weather-rain',
    dataUrl: 'data:audio/mpeg;base64,SUQz',
  }
  const knockFile = {
    ...rainFile,
    key: 'preset:se/knock',
    id: 'tpl-se-knock',
    label: 'ノック（木の扉）',
    preset: 'preset:se/knock',
  }

  it('zip では assets/se/<slug>.mp3 に入り、シナリオは src で指す。クレジットは素材の行', () => {
    const files = buildNovelGameFiles(
      work,
      episode,
      staging([{ blockId: 'b1', se: 'preset:se/weather-rain', seRepeat: 'loop' }]),
      { userAssets: [rainFile] },
    )
    const s = scenarioOf(files)
    expect(s.pages[0]?.se).toBe('preset:se/weather-rain')
    expect(s.ses?.['preset:se/weather-rain']).toEqual({
      label: '雨（強）',
      src: 'assets/se/weather-rain.mp3',
    })
    expect(files.some((f) => f.path === 'assets/se/weather-rain.mp3')).toBe(true)
    expect(s.credits.find((c) => c.label === '効果音素材')?.body).toContain('雨（強）')
    expect(s.credits.find((c) => c.label === '効果音')).toBeUndefined()
  })

  it('同じキーの合成レシピより音声ファイルが優先され、無ければ合成のまま', () => {
    const withFile = scenarioOf(
      buildNovelGameFiles(work, episode, staging([{ blockId: 'b1', se: 'preset:se/knock' }]), {
        userAssets: [knockFile],
      }),
    )
    expect(withFile.ses?.['preset:se/knock']?.src).toBe('assets/se/knock.mp3')
    expect(withFile.ses?.['preset:se/knock']?.steps).toBeUndefined()

    const synth = scenarioOf(
      buildNovelGameFiles(work, episode, staging([{ blockId: 'b1', se: 'preset:se/knock' }])),
    )
    expect(synth.ses?.['preset:se/knock']?.steps?.length).toBeGreaterThan(0)
    expect(synth.credits.find((c) => c.label === '効果音')?.body).toContain('ノック')
  })

  it('契約 v5 では asset:<id> で参照され、その id が拾われる', () => {
    const asset = {
      id: 'tpl-se-weather-rain',
      kind: 'se' as const,
      name: '雨（強）',
      dataUrl: 'data:audio/mpeg;base64,SUQz',
      tone: ['#000000', '#000000', '#000000'] as [string, string, string],
      preset: 'preset:se/weather-rain',
      createdAt: 1,
    }
    const { html, assetIds } = buildNovelGamePlayer(
      work,
      episode,
      staging([{ blockId: 'b1', se: 'preset:se/weather-rain' }]),
      { gameAssets: [asset] },
    )
    expect(assetIds).toEqual(['tpl-se-weather-rain'])
    const s = scenarioOf([{ path: 'index.html', data: html }])
    expect(s.ses?.['preset:se/weather-rain']?.src).toBe('asset:tpl-se-weather-rain')
  })
})

describe('BGM（目録の曲・preset 付きの素材）', () => {
  const ep: Episode = {
    id: 'e9',
    title: '音の話',
    blocks: parseEpisodeBody('　雨が降りはじめた。\n「——行こうか」\n　やがて、雨はやんだ。'),
  }
  const w: Work = { id: 'w1', title: '作品', episodes: [ep] }
  const morning = {
    key: 'preset:bgm/bgm-calm-morning',
    id: 'tpl-bgm-bgm-calm-morning',
    label: '朝',
    tone: ['#000000', '#000000', '#000000'] as [string, string, string],
    mime: 'audio/mpeg',
    data: new Uint8Array([73, 68, 51]),
    kind: 'bgm' as const,
    preset: 'preset:bgm/bgm-calm-morning',
    dataUrl: 'data:audio/mpeg;base64,SUQz',
    loopStart: 4.5,
    loopEnd: 88,
  }
  const chase = {
    ...morning,
    key: 'preset:bgm/bgm-tense-chase',
    id: 'tpl-bgm-bgm-tense-chase',
    label: '追走',
    preset: 'preset:bgm/bgm-tense-chase',
    loopStart: undefined,
    loopEnd: undefined,
  }
  const cues = (list: Staging['cues']): Staging => ({
    workId: 'w1',
    episodeId: 'e9',
    cues: list,
    updatedAt: 1,
  })

  it('曲が変わるページにだけ載り、使った曲だけ zip に同梱される。ループ区間とクレジットも載る', () => {
    const files = buildNovelGameFiles(
      w,
      ep,
      cues([
        { blockId: 'b1', bgm: 'preset:bgm/bgm-calm-morning' },
        { blockId: 'b2', bgm: 'preset:bgm/bgm-calm-morning', sceneBreak: true }, // 同じ曲＝載せ直さない
        { blockId: 'b3', bgm: 'preset:bgm/bgm-tense-chase' },
      ]),
      { userAssets: [morning, chase] },
    )
    const s = scenarioOf(files)
    expect(s.pages.map((p) => p.bgm)).toEqual([
      'preset:bgm/bgm-calm-morning',
      undefined,
      'preset:bgm/bgm-tense-chase',
    ])
    expect(s.bgms).toEqual({
      'preset:bgm/bgm-calm-morning': {
        label: '朝',
        src: 'assets/bgm/bgm-calm-morning.mp3',
        loopStart: 4.5,
        loopEnd: 88,
      },
      'preset:bgm/bgm-tense-chase': { label: '追走', src: 'assets/bgm/bgm-tense-chase.mp3' },
    })
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['assets/bgm/bgm-calm-morning.mp3', 'assets/bgm/bgm-tense-chase.mp3']),
    )
    expect(s.credits.find((c) => c.label === 'BGM')?.body).toBe('コトノハ 標準BGM素材（朝・追走）')
    // 画面（続きレーン）の説明と書き出しが一致する（切れ目をまたいでも同じ曲が続く）
    const cont = resolveContinuity(
      applyCues(
        toPages(ep.blocks),
        cues([
          { blockId: 'b1', bgm: 'preset:bgm/bgm-calm-morning' },
          { blockId: 'b2', bgm: 'preset:bgm/bgm-calm-morning', sceneBreak: true },
          { blockId: 'b3', bgm: 'preset:bgm/bgm-tense-chase' },
        ]),
      ),
    )
    expect(cont.map((c) => c.bgm)).toEqual([
      'preset:bgm/bgm-calm-morning',
      'preset:bgm/bgm-calm-morning',
      'preset:bgm/bgm-tense-chase',
    ])
  })

  it('「止める」は鳴っているときだけページに載り、手元に無い曲は無視して壊さない', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        w,
        ep,
        cues([
          { blockId: 'b1', bgm: 'stop' }, // まだ何も鳴っていない＝載せない
          { blockId: 'b2', bgm: 'preset:bgm/bgm-calm-morning' },
          { blockId: 'b3', bgm: 'stop' },
        ]),
        { userAssets: [morning] },
      ),
    )
    expect(s.pages.map((p) => p.bgm)).toEqual([undefined, 'preset:bgm/bgm-calm-morning', 'stop'])
    const none = scenarioOf(
      buildNovelGameFiles(w, ep, cues([{ blockId: 'b1', bgm: 'preset:bgm/nowhere' }])),
    )
    expect(none.pages[0]?.bgm).toBeUndefined()
    expect(none.bgms).toBeUndefined()
    expect(none.credits.some((c) => c.label === 'BGM')).toBe(false)
  })

  it('契約 v5 では asset:<id> で参照され、その id が拾われる（投稿は音声なので v6）', () => {
    const asset = {
      id: 'tpl-bgm-bgm-calm-morning',
      kind: 'bgm' as const,
      name: '朝',
      dataUrl: 'data:audio/mpeg;base64,SUQz',
      tone: ['#000000', '#000000', '#000000'] as [string, string, string],
      preset: 'preset:bgm/bgm-calm-morning',
      loopStart: 4.5,
      loopEnd: 88,
      createdAt: 1,
    }
    const { html, assetIds } = buildNovelGamePlayer(
      w,
      ep,
      cues([{ blockId: 'b1', bgm: 'preset:bgm/bgm-calm-morning' }]),
      { gameAssets: [asset] },
    )
    expect(assetIds).toEqual(['tpl-bgm-bgm-calm-morning'])
    const s = scenarioOf([{ path: 'index.html', data: html }])
    expect(s.bgms?.['preset:bgm/bgm-calm-morning']).toEqual({
      label: '朝',
      src: 'asset:tpl-bgm-bgm-calm-morning',
      loopStart: 4.5,
      loopEnd: 88,
    })
    // プレイヤーには BGM のあり／なしボタンがある
    expect(html).toContain('id="btnBgm"')
  })
})
