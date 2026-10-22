import { describe, expect, it } from 'vitest'
import type { Block } from '../../schema'
import { nameSampleTokens } from './fixtures'
import {
  findNameCandidates,
  inlineSignalsOf,
  type KnownReading,
  type NameSourceEpisode,
} from './name-candidates'
import { isUnknownToken } from './token'

/** 例文（names.json＝実物の lindera の出力）から話を作る。 */
const ep = (
  texts: string[],
  extra: Pick<NameSourceEpisode, 'rubies' | 'refs'> = {},
): NameSourceEpisode => ({ texts, tokens: texts.map(nameSampleTokens), ...extra })

/** ルビの親文字が辞書の1語で、読みがルビと同じか（Worker の判定と同じ形を例文で）。 */
const knownReading: KnownReading = (base, reading) => {
  try {
    const t = nameSampleTokens(base)
    return t.length === 1 && t[0] !== undefined && !isUnknownToken(t[0]) && t[0].reading === reading
  } catch {
    return false
  }
}

const find = (episodes: NameSourceEpisode[], excluded: string[] = []) =>
  findNameCandidates(episodes, new Set(excluded), knownReading)
const names = (episodes: NameSourceEpisode[], excluded: string[] = []) =>
  find(episodes, excluded).map((c) => c.name)

const FANTASY = [
  '「リリアーナ様、お待ちください」',
  'アルヴェインが叫んだ。リリアーナ様は振り返らない。',
  '「アルヴェインが叫んだ？」',
]

describe('findNameCandidates（名前の候補・COT-59 FR-2）', () => {
  it('辞書に無いカタカナ語と敬称：リリアーナは人物、アルヴェインは分類なし', () => {
    const c = find([ep(FANTASY)])
    expect(c.find((x) => x.name === 'リリアーナ')).toMatchObject({
      count: 2,
      episodes: 1,
      category: '人物',
      reading: 'りりあーな',
    })
    const a = c.find((x) => x.name === 'アルヴェイン')
    expect(a).toMatchObject({ count: 2, reading: 'あるゔぇいん' })
    // 辞書に無い語に付いた細分類（未知語の 固有名詞,一般 など）で分類を付けない
    expect(a?.category).toBeUndefined()
  })

  it('字下げの全角空白と括弧（辞書に無い語として名詞になる）を名前に含めない', () => {
    const c = find([
      ep([
        '　「リリアーナ様、お待ちください」',
        'アルヴェインが叫んだ。リリアーナ様は振り返らない。',
      ]),
    ])
    expect(c.map((x) => x.name)).toContain('リリアーナ')
    expect(c.some((x) => /[「　]/u.test(x.name))).toBe(false)
  })

  it('1字ずつに割れた漢字の名前を拾い、読みは空にする', () => {
    const c = find([ep(['朔夜は湊斗の手を取った。', '朔夜の声は震えていた。', '「湊斗、行こう」'])])
    expect(c.map((x) => x.name).sort()).toEqual(['朔夜', '湊斗'].sort())
    for (const x of c) expect(x.reading).toBeUndefined()
  })

  it('辞書の固有名詞と敬称：宮森は人物・みやもり。1回だけの佐伯は出さない', () => {
    const c = find([ep(['佐伯先輩と宮森さんは、生徒会室にいた。', '宮森さんは生徒会長だ。'])])
    expect(c).toEqual([
      expect.objectContaining({ name: '宮森', count: 2, category: '人物', reading: 'みやもり' }),
    ])
  })

  it('敬称の前でも、辞書にある一般の語1つだけ（店員さん）と除外リストの語（妹ちゃん）は出さない', () => {
    expect(names([ep(['店員さんに聞いた。店員さんが笑った。'])])).toEqual([])
    expect(names([ep(['妹ちゃんが来た。妹ちゃんは眠い。'])])).toEqual([])
  })

  it('敬称の前の漢字1字の名前は拾う（澪ちゃん）', () => {
    expect(find([ep(['澪ちゃん、こっち。澪ちゃんは頷いた。'])])).toEqual([
      expect.objectContaining({ name: '澪', count: 2, category: '人物', reading: 'みお' }),
    ])
  })

  it('字下げのある段落でも、割れた漢字に敬称が付けば人物（「　灯里ちゃん」・解析前に全角空白を半角に替える）', () => {
    const c = find([ep(['　灯里ちゃんが手を振る。湊斗は灯里に笑い返した。'])])
    expect(c.find((x) => x.name === '灯里')).toMatchObject({ count: 2, category: '人物' })
    expect(c.some((x) => x.name === '里')).toBe(false)
  })

  it('割れた漢字に敬称が付けば人物（灯里ちゃん）', () => {
    const c = find([ep(['灯里ちゃんが手を振る。湊斗は灯里に笑い返した。'])])
    expect(c.find((x) => x.name === '灯里')).toMatchObject({ count: 2, category: '人物' })
  })

  it('辞書の地域と後ろの「駅」で場所（新宿）', () => {
    expect(find([ep(['新宿駅の東口で待った。新宿は雨だった。'])])).toEqual([
      expect.objectContaining({ name: '新宿', count: 2, category: '場所', reading: 'しんじゅく' }),
    ])
  })

  it('辞書の読みと違うルビは1回でも候補、同じルビ（読み仮名）は除く', () => {
    const c = find([
      ep(['黒鉄騎士団の旗が揺れる。憂鬱な朝だった。'], {
        rubies: [
          { base: '黒鉄', reading: 'くろがね' },
          { base: '憂鬱', reading: 'ゆううつ' },
        ],
      }),
    ])
    expect(c).toEqual([
      expect.objectContaining({ name: '黒鉄', count: 1, reading: 'くろがね', signals: ['ruby'] }),
    ])
  })

  it('用語集に無い [[ ]] は1回でも候補', () => {
    const c = find([ep(['エルフのシェリスが肩をすくめる。'], { refs: ['シェリス'] })])
    expect(c.find((x) => x.name === 'シェリス')).toMatchObject({ count: 1 })
    expect(c.find((x) => x.name === 'シェリス')?.signals).toContain('ref')
  })

  it('用語集の名前と別名は候補にしない', () => {
    expect(names([ep(FANTASY)], ['リリアーナ', 'リリィ'])).toEqual(['アルヴェイン'])
  })

  it('辞書に足した今の言葉（スマートフォン）と時刻（七時）は候補にしない', () => {
    expect(names([ep(['スマートフォンを見た。スマートフォンが鳴った。'])])).toEqual([])
    expect(names([ep(['七時に起きた。七時半に家を出た。'])])).toEqual([])
  })

  it('回数は作品全体の文字列で数え、出てくる話の数も返す', () => {
    const c = find([
      ep(['グランヴェルの夜は長い。']),
      ep(['王都グランヴェルの城門を、黒鉄騎士団が固めていた。']),
    ])
    expect(c.find((x) => x.name === 'グランヴェル')).toMatchObject({ count: 2, episodes: 2 })
  })

  it('回数の多い順、同じなら localeCompare(ja) の順', () => {
    const c = find([
      ep([...FANTASY, '朔夜は湊斗の手を取った。', '朔夜の声は震えていた。', '「湊斗、行こう」']),
      ep(['灯里ちゃんが手を振る。湊斗は灯里に笑い返した。']),
    ])
    expect(c[0]).toMatchObject({ name: '湊斗', count: 3, episodes: 2 })
    const twos = c.filter((x) => x.count === 2).map((x) => x.name)
    expect(twos).toEqual([...twos].sort((a, b) => a.localeCompare(b, 'ja')))
  })
})

describe('inlineSignalsOf（話の記法からルビと [[ ]] を取り出す）', () => {
  it('ルビ・[[ ]]・ルビを重ねた [[ ]] のルビを取り出す', () => {
    const blocks: Block[] = [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [
          { type: 'text', text: '　' },
          { type: 'ruby', base: '黒鉄', reading: 'くろがね' },
          { type: 'ref', name: ' シェリス ' },
          {
            type: 'ref',
            name: '言葉',
            children: [{ type: 'ruby', base: '言葉', reading: 'ことば' }],
          },
          { type: 'ref', name: '  ' },
        ],
      } as Block,
    ]
    expect(inlineSignalsOf(blocks)).toEqual({
      rubies: [
        { base: '黒鉄', reading: 'くろがね' },
        { base: '言葉', reading: 'ことば' },
      ],
      refs: ['シェリス', '言葉'],
    })
  })
})
