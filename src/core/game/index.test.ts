import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode, GlossaryEntry } from '../schema'
import {
  applyCues,
  classifyBlock,
  findOrphanCues,
  plainTextOfBlock,
  type Staging,
  StagingSchema,
  suggestSceneBreaks,
  suggestSpeaker,
  toPages,
} from '.'

const entry = (over: Partial<GlossaryEntry> & { name: string }): GlossaryEntry => ({
  id: `g-${over.name}`,
  aliases: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const staging = (cues: Staging['cues']): Staging => ({
  workId: 'w1',
  episodeId: 'e1',
  cues,
  updatedAt: 0,
})

describe('classifyBlock（セリフ・地の文・間）', () => {
  it('「 で始まる block はセリフ', () => {
    const [b] = parseEpisodeBody('「——まだ、書いてるんだね」')
    expect(classifyBlock(b!)).toBe('dialogue')
  })

  it('『 で始まる block もセリフ', () => {
    const [b] = parseEpisodeBody('『これは看板の文字』')
    expect(classifyBlock(b!)).toBe('dialogue')
  })

  it('字下げ（全角空白）の先の 「 もセリフと判定する', () => {
    const [b] = parseEpisodeBody('　「おはよう」')
    expect(classifyBlock(b!)).toBe('dialogue')
  })

  it('それ以外は地の文（字下げつきの通常行）', () => {
    const [b] = parseEpisodeBody('　雨は夜半から強くなった。')
    expect(classifyBlock(b!)).toBe('narration')
  })

  it('空 block は間（gap）', () => {
    const [b] = parseEpisodeBody('')
    expect(classifyBlock(b!)).toBe('gap')
  })

  it('空白しかない block も間として扱う', () => {
    const [b] = parseEpisodeBody('　　')
    expect(classifyBlock(b!)).toBe('gap')
  })

  it('ルビ・参照で始まる行も判別できる（プレーン文字列で判定）', () => {
    const [b] = parseEpisodeBody('｜東京《とうきょう》の朝。')
    expect(classifyBlock(b!)).toBe('narration')
  })
})

describe('plainTextOfBlock（純本文）', () => {
  it('ルビは親文字だけ（読みを括弧で足さない＝画面に出る文字と 1:1）', () => {
    const [b] = parseEpisodeBody('｜灯《あかり》は笑った。')
    expect(plainTextOfBlock(b!)).toBe('灯は笑った。')
  })

  it('傍点・参照はプレーン文字列へ落ちる', () => {
    const [b] = parseEpisodeBody('《《ここ》》で[[灯]]が待つ。')
    expect(plainTextOfBlock(b!)).toBe('ここで灯が待つ。')
  })

  it('ルビつき参照は親文字へ落ちる', () => {
    const [b] = parseEpisodeBody('[[｜灯《あかり》]]が来た。')
    expect(plainTextOfBlock(b!)).toBe('灯が来た。')
  })
})

describe('toPages（改ページ＝gap の畳み込み）', () => {
  it('gap を挟んだ本文が beat つきのページになる', () => {
    const blocks = parseEpisodeBody('一行目。\n\n二行目。\n\n\n三行目。')
    const pages = toPages(blocks)
    expect(pages.map((p) => p.beat)).toEqual([0, 1, 2])
    expect(pages.map((p) => p.blockId)).toEqual(['b1', 'b3', 'b6'])
  })

  it('冒頭の空行は最初のページの beat になり、末尾の空行は落ちる', () => {
    const pages = toPages(parseEpisodeBody('\n本文。\n\n'))
    expect(pages).toHaveLength(1)
    expect(pages[0]?.beat).toBe(1)
  })

  it('セリフと地の文の kind が付く', () => {
    const pages = toPages(parseEpisodeBody('　地の文。\n「セリフ」'))
    expect(pages.map((p) => p.kind)).toEqual(['narration', 'dialogue'])
  })

  it('入力の blocks を変更しない（正本の不変）', () => {
    const blocks = parseEpisodeBody('一行目。\n\n「二行目」')
    const before = JSON.stringify(blocks)
    toPages(blocks)
    expect(JSON.stringify(blocks)).toBe(before)
  })
})

describe('applyCues（演出の突き合わせ）', () => {
  const blocks = parseEpisodeBody('　夜道を歩く。\n「——まだ、書いてるんだね」')

  it('Staging なしでもページが成立する（演出ゼロでプレイできる）', () => {
    const pages = applyCues(toPages(blocks), undefined)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.speaker).toBeUndefined()
  })

  it('blockId が一致した cue の演出が載る', () => {
    const pages = applyCues(
      toPages(blocks),
      staging([
        { blockId: 'b1', bg: 'preset:bg/road-night', sceneBreak: true, transition: 'fade' },
        { blockId: 'b2', speaker: '灯' },
      ]),
    )
    expect(pages[0]).toMatchObject({ bg: 'preset:bg/road-night', sceneBreak: true })
    expect(pages[1]?.speaker).toBe('灯')
  })

  it('同じ blockId の cue は後勝ち', () => {
    const pages = applyCues(
      toPages(blocks),
      staging([
        { blockId: 'b2', speaker: '灯' },
        { blockId: 'b2', speaker: '暁' },
      ]),
    )
    expect(pages[1]?.speaker).toBe('暁')
  })

  it('cue の blockId はページへ漏れない（アンカーのままに保つ）', () => {
    const pages = applyCues(toPages(blocks), staging([{ blockId: 'b1', bg: 'x' }]))
    expect(pages[0]?.blockId).toBe('b1')
  })
})

describe('findOrphanCues（行き先を失った演出）', () => {
  const episode: Episode = { id: 'e1', title: '第一話', blocks: parseEpisodeBody('一。\n二。') }

  it('存在しない blockId を指す cue だけを列挙する', () => {
    const s = staging([
      { blockId: 'b1', bg: 'a' },
      { blockId: 'b9', speaker: '灯' },
    ])
    const orphans = findOrphanCues(s, episode)
    expect(orphans).toHaveLength(1)
    expect(orphans[0]?.blockId).toBe('b9')
  })

  it('Staging 自体は書き換えない（自動削除しない）', () => {
    const s = staging([{ blockId: 'b9', speaker: '灯' }])
    findOrphanCues(s, episode)
    expect(s.cues).toHaveLength(1)
  })
})

describe('suggestSceneBreaks（提案のみ）', () => {
  it('空行2つ以上のあとの本文 block を候補に挙げる', () => {
    const blocks = parseEpisodeBody('一。\n\n二。\n\n\n三。')
    expect(suggestSceneBreaks(blocks)).toEqual(['b6'])
  })

  it('冒頭の空行は候補にしない', () => {
    const blocks = parseEpisodeBody('\n\n一。')
    expect(suggestSceneBreaks(blocks)).toEqual([])
  })
})

describe('suggestSpeaker（辞書からの話者候補・外れてよい）', () => {
  const entries = [
    entry({ name: '灯', category: '人物' }),
    entry({ name: '桜庭', category: '人物', aliases: ['先輩'] }),
    entry({ name: '喫茶ホタル', category: '場所' }),
  ]

  it('直前の地の文の [[参照]] から人物を当てる', () => {
    const blocks = parseEpisodeBody('　[[灯]]が振り返った。\n「——まだ、書いてるんだね」')
    expect(suggestSpeaker(blocks, 1, entries)).toBe('灯')
  })

  it('別名の参照でも正式名（entry.name）を返す', () => {
    const blocks = parseEpisodeBody('　[[先輩]]が笑う。\n「そうかな」')
    expect(suggestSpeaker(blocks, 1, entries)).toBe('桜庭')
  })

  it('人物でない参照（場所など）は候補にしない', () => {
    const blocks = parseEpisodeBody('　[[喫茶ホタル]]に着いた。\n「いらっしゃい」')
    expect(suggestSpeaker(blocks, 1, entries)).toBeUndefined()
  })

  it('セリフでない block・手がかりが無いときは undefined', () => {
    const blocks = parseEpisodeBody('　誰かが言った。\n「……」')
    expect(suggestSpeaker(blocks, 0, entries)).toBeUndefined()
    expect(suggestSpeaker(blocks, 1, entries)).toBeUndefined()
  })
})

describe('StagingSchema（後方互換の入口）', () => {
  it('cue の任意項目は省略できる', () => {
    const parsed = StagingSchema.parse({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b1' }],
      updatedAt: 1,
    })
    expect(parsed.cues[0]?.speaker).toBeUndefined()
  })
})
