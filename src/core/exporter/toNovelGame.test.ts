import { describe, expect, it } from 'vitest'
import type { Staging } from '../game'
import { DEFAULT_BG_KEY } from '../game/presets'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode, Work } from '../schema'
import type { GameScenario } from './novelGamePlayer'
import { buildNovelGameFiles, unitsOfInlines } from './toNovelGame'

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
    expect(paths).toContain('assets/bg/abstract-night.svg')
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
    expect(paths).not.toContain('assets/bg/abstract-night.svg')
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
    expect(bg?.body).toContain('抽象（夜）')
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
    expect(html.match(/<\/script>/g)?.length).toBe(2) // シナリオ用と プレイヤー本体のみ
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

describe('立ち絵（話者に自動で紐づく舞台・最大2人）', () => {
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

  it('1人目は中央でアクティブ。地の文・話者未設定のセリフは据え置き（マーカー無し）', () => {
    const files = buildNovelGameFiles(
      work,
      spriteEpisode,
      staging([{ blockId: 'b1', speaker: '灯' }]),
      opts,
    )
    const s = scenarioOf(files)
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
    expect(s.pages[1]?.stage).toBeUndefined()
    expect(s.pages[2]?.stage).toBeUndefined()
    expect(s.sprites?.['user:ak-n']).toEqual({
      src: 'assets/sprite/user-ak-n.webp',
      label: '灯（通常）',
    })
    const paths = files.map((f) => f.path)
    expect(paths).toContain('assets/sprite/user-ak-n.webp')
    expect(paths).not.toContain('assets/sprite/user-be-n.webp') // 未使用は同梱しない
    // プレイヤーに立ち絵の舞台がある
    const html = files.find((f) => f.path === 'index.html')?.data as string
    expect(html).toContain('id="sprites"')
  })

  it('表情（cue.expression）はその場で差し替え（席はそのまま）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯' },
          { blockId: 'b3', speaker: '灯', expression: '笑顔' },
        ]),
        opts,
      ),
    )
    expect(s.pages[0]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }])
    expect(s.pages[2]?.stage).toEqual([{ k: 'user:ak-s', p: 'c', a: 1 }])
  })

  it('2人目が来ると先客が左へ寄り、右に入る（話している方だけアクティブ）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯' },
          { blockId: 'b3', speaker: 'ベニ' },
        ]),
        opts,
      ),
    )
    expect(s.pages[2]?.stage).toEqual([
      { k: 'user:ak-n', p: 'l' },
      { k: 'user:be-n', p: 'r', a: 1 },
    ])
  })

  it('3人目は「最近話していない方」と交代し、席（左右）を引き継ぐ', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯' },
          { blockId: 'b3', speaker: 'ベニ' },
          { blockId: 'b4', speaker: 'サク' },
        ]),
        opts,
      ),
    )
    expect(s.pages[3]?.stage).toEqual([
      { k: 'user:sa-n', p: 'l', a: 1 }, // 灯（最近話していない）と交代して左席へ
      { k: 'user:be-n', p: 'r' },
    ])
  })

  it('立ち絵の無い話者・？？？のセリフでは退場させず、全員が減光する', () => {
    const base = [
      { blockId: 'b1', speaker: '灯' },
      { blockId: 'b3', speaker: 'ベニ' },
    ]
    for (const third of [
      { blockId: 'b4', speaker: '？？？' },
      { blockId: 'b4', speaker: 'モブ' },
    ]) {
      const s = scenarioOf(
        buildNovelGameFiles(work, spriteEpisode, staging([...base, third]), opts),
      )
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
          { blockId: 'b1', speaker: '灯' },
          { blockId: 'b5', sceneBreak: true },
        ]),
        opts,
      ),
    )
    expect(s.pages[4]?.stage).toEqual([])
  })

  it('立ち絵が無ければシナリオは従来のまま（sprites も stage マーカーも出ない）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(work, spriteEpisode, staging([{ blockId: 'b1', speaker: '灯' }])),
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

  it('登場（appear）：地の文からセリフの前に立ち絵を出せる（明るくはしない）', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b2', appear: '灯' }, // 地の文で登場
          { blockId: 'b3', speaker: '灯' }, // ここで初めて話す
        ]),
        opts,
      ),
    )
    expect(s.pages[1]?.stage).toEqual([{ k: 'user:ak-n', p: 'c' }]) // 立つが a 無し
    expect(s.pages[2]?.stage).toEqual([{ k: 'user:ak-n', p: 'c', a: 1 }]) // 話して明るく
  })

  it('立ち絵を出さない（hideSprite）：舞台を空にし、次の場面の切れ目まで話者も出さない', () => {
    // 人物ごと描いた一枚絵の背景に立ち絵が重なるのを止める欄（D-GAME-SPRITE-OFF）
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯' }, // 立つ
          { blockId: 'b2', hideSprite: true }, // 地の文で下ろす
          { blockId: 'b3', speaker: '灯' }, // 話しても出さない
          { blockId: 'b4', sceneBreak: true, speaker: '灯' }, // 場面が変われば戻る
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

  it('立ち絵を出さない区間でも、登場（appear）を指定すれば戻る', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯' },
          { blockId: 'b2', hideSprite: true },
          { blockId: 'b5', appear: '灯' }, // 同じ場面のまま出し直す
        ]),
        opts,
      ),
    )
    expect(s.pages[1]?.stage).toEqual([])
    expect(s.pages[4]?.stage).toEqual([{ k: 'user:ak-n', p: 'c' }])
  })

  it('登場は席の割り当てに従い、既に立っている人物・立ち絵の無い人物・？？？は無視', () => {
    const s = scenarioOf(
      buildNovelGameFiles(
        work,
        spriteEpisode,
        staging([
          { blockId: 'b1', speaker: '灯' },
          { blockId: 'b2', appear: 'ベニ' }, // 2人目＝左右へ
          { blockId: 'b5', appear: 'モブ' }, // 立ち絵なし＝据え置き
        ]),
        opts,
      ),
    )
    expect(s.pages[1]?.stage).toEqual([
      { k: 'user:ak-n', p: 'l', a: 1 }, // 灯は話者のまま明るい
      { k: 'user:be-n', p: 'r' },
    ])
    expect(s.pages[4]?.stage).toBeUndefined()
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
    const files = buildNovelGameFiles(work, ep, staging([{ blockId: 'b1', speaker: '灯' }]), {
      userAssets: [tplAsset],
    })
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
    expect(s.ses?.['preset:se/bell']?.steps.length).toBeGreaterThan(0)
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
      buildNovelGameFiles(work, ep, staging([{ blockId: 'b1', speaker: '灯' }]), {
        userAssets: [own],
      }),
    )
    expect(s.credits.some((c) => c.label === '立ち絵')).toBe(false)
  })
})
