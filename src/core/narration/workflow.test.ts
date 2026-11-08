import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import {
  cueIsValid,
  openingSegments,
  readingCuesNeedingReview,
  resolveSegments,
  segmentFingerprint,
} from './resolve'
import { emptyNarration } from './types'

describe('文章選択と読み方', () => {
  it('台詞の句点でも分割し、話別スタイルと語句だけの読みを反映する', () => {
    const episode = {
      id: 'e',
      title: '話',
      blocks: parseEpisodeBody('朝になった。「社へ。帰ろう」雨がやんだ。'),
    }
    const settings = emptyNarration('w').settings
    settings.episodes = { e: { style: 'quiet', narrator: 'default' } }
    settings.cues = [
      {
        id: 'c',
        episodeId: 'e',
        scope: 'range',
        refs: [
          { blockId: 'b1', snapshot: '朝になった。「社へ。帰ろう」雨がやんだ。', start: 7, end: 8 },
        ],
        reading: 'やしろ',
        direction: '寂しそうに',
      },
    ]
    const segments = resolveSegments(episode, settings)
    expect(segments).toHaveLength(4)
    expect(segments[1]?.text).toBe('「やしろへ。')
    expect(segments[0]?.direction).toBe('静かに落ち着いて、言葉の余韻を大切に')
    expect(segments[1]?.direction).toBe('寂しそうに')
    expect(resolveSegments({ ...episode, id: 'other' }, settings)[0]?.direction).toBe('')
  })
  it('前の文章の編集後も一意に対応できる語句を保持し、曖昧なら確認待ち', () => {
    const settings = emptyNarration('w').settings
    const cue = {
      id: 'c',
      episodeId: 'e',
      scope: 'range' as const,
      refs: [{ blockId: 'b1', snapshot: '朝。社へ。', start: 2, end: 3 }],
      reading: 'やしろ',
    }
    settings.cues = [cue]
    const changed = { id: 'e', title: '話', blocks: parseEpisodeBody('長い朝。社へ。') }
    expect(cueIsValid(cue, changed)).toBe(true)
    expect(resolveSegments(changed, settings)[1]?.text).toBe('やしろへ。')
    expect(cueIsValid(cue, { ...changed, blocks: parseEpisodeBody('社。社。') })).toBe(false)
  })
  it('試聴は自然な文末までで300文字を超えない', () => {
    const segments = resolveSegments(
      { id: 'e', title: '話', blocks: parseEpisodeBody('空を見上げた。'.repeat(80)) },
      emptyNarration('w').settings,
    )
    const opening = openingSegments(segments)
    expect(opening.reduce((n, s) => n + s.characters, 0)).toBeLessThanOrEqual(300)
    expect(opening.length).toBeGreaterThan(0)
    expect(opening.at(-1)?.text.endsWith('。')).toBe(true)
  })
})

it('別の文の声指定が既定声のfingerprintに混ざらない', () => {
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('朝。夜。') }
  const settings = emptyNarration('w').settings
  settings.cues = [
    {
      id: 'voice',
      episodeId: 'e',
      scope: 'range',
      refs: [{ blockId: 'b1', snapshot: '朝。夜。', start: 2, end: 4 }],
      voiceId: 'other',
    },
  ]
  const generation = {
    model: 'drama-3',
    voices: [
      { id: 'default', version: '1' },
      { id: 'other', version: '2' },
    ],
  }
  const segments = resolveSegments(episode, settings, undefined, generation)
  expect(segments.map((s) => s.voiceId)).toEqual(['default', 'other'])
  for (const s of segments)
    expect(s.fingerprint).toBe(
      segmentFingerprint(
        s,
        generation.model,
        generation.voices.find((v) => v.id === s.voiceId)?.version,
      ),
    )
})

it('明示したモードは話別。複数の声は範囲指定だけを使い、ひとり朗読でも指定を保持する', () => {
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('朝。夜。') }
  const settings = emptyNarration('w').settings
  settings.mode = 'cast'
  settings.cast = { speaker: 'legacy-voice' }
  settings.episodes = { e: { style: 'personal', narrator: 'default', mode: 'cast' } }
  settings.cues = [
    {
      id: 'voice',
      episodeId: 'e',
      scope: 'range',
      refs: [{ blockId: 'b1', snapshot: '朝。夜。', start: 2, end: 4 }],
      voiceId: 'other',
      style: 'quiet',
    },
  ]
  const staging = {
    workId: 'w',
    updatedAt: 1,
    episodeId: 'e',
    cues: [{ blockId: 'b1', speaker: 'speaker' }],
  } satisfies NonNullable<Parameters<typeof resolveSegments>[2]>
  const multi = resolveSegments(episode, settings, staging)
  expect(multi.map((s) => s.voiceId)).toEqual(['default', 'other'])
  expect(multi[1]?.direction).toBe('静かに落ち着いて、言葉の余韻を大切に')
  expect(multi[1]?.speed).toBe(0.95)
  expect(multi[1]?.pauseMs).toBe(700)
  settings.episodes.e!.mode = 'solo'
  expect(resolveSegments(episode, settings, staging).map((s) => s.voiceId)).toEqual([
    'default',
    'default',
  ])
  expect(settings.cues[0]?.voiceId).toBe('other')
  settings.episodes.e!.mode = 'cast'
  expect(resolveSegments(episode, settings, staging)).toEqual(multi)
  // Old saved casting remains effective until the user selects the new mode.
  delete settings.episodes.e!.mode
  expect(resolveSegments(episode, settings, staging)[0]?.voiceId).toBe('legacy-voice')
})

it('サウンドノベルの場面区切りを新しい朗読の間に取り込まない', () => {
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('朝になった。') }
  const settings = emptyNarration('w').settings
  const staging = {
    workId: 'w',
    episodeId: 'e',
    updatedAt: 1,
    cues: [{ blockId: 'b1', sceneBreak: true }],
  }
  expect(resolveSegments(episode, settings, staging)[0]?.pauseMs).toBe(350)
  expect(
    resolveSegments(episode, settings, staging, { model: '', voices: [], legacy: true })[0]
      ?.pauseMs,
  ).toBe(700)
})

it('句点・疑問符・感嘆符・閉じかっこを区切りとし、読点は分割しない', () => {
  const text = '母は、笑った。「本当？うれしい！！ありがとう。」帰ろう。'
  const pieces = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody(text) },
    emptyNarration('w').settings,
  )
  expect(pieces.map((s) => s.text)).toEqual([
    '母は、笑った。',
    '「本当？',
    'うれしい！！',
    'ありがとう。」',
    '帰ろう。',
  ])
  expect(pieces.map((s) => s.text).join('')).toBe(text)
  expect(pieces.every((s) => s.pauseMs === 350)).toBe(true)
})

it('段落末の指定は句点の間と重ねず、長い文を読点で勝手に分割しない', () => {
  const settings = emptyNarration('w').settings
  settings.cues = [{ id: 'gap', episodeId: 'e', scope: 'episode', refs: [], pauseMs: 700 }]
  const pieces = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody('朝。夜。') },
    settings,
  )
  expect(pieces.map((s) => s.pauseMs)).toEqual([350, 700])
  const long = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody('長い、'.repeat(300) + '終わり。') },
    settings,
  )
  expect(long).toHaveLength(1)
  expect(long[0]!.characters).toBeGreaterThan(800)
})

it('同じ一文の読みを前半・後半で直しても、原文の順序と生成単位を保つ', () => {
  const text = 'お母さんは首にかけていたネックレスをわたしの首にかけてくれた。'
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody(text) }
  const settings = emptyNarration('w').settings
  const boundary = text.indexOf('わたし')
  const original = resolveSegments(episode, settings)[0]!
  settings.cues = [
    {
      id: 'first',
      episodeId: 'e',
      scope: 'range',
      refs: [{ blockId: 'b1', snapshot: text, start: 0, end: boundary }],
      reading: 'おかあさんはくびにかけていたねっくれすを',
    },
    {
      id: 'last',
      episodeId: 'e',
      scope: 'range',
      refs: [{ blockId: 'b1', snapshot: text, start: boundary, end: text.length - 1 }],
      reading: 'わたしのくびにかけてくれた',
    },
  ]
  const pieces = resolveSegments(episode, settings)
  expect(pieces).toHaveLength(1)
  expect(pieces[0]!.id).toBe(original.id)
  expect(pieces[0]!.text).toBe(
    'おかあさんはくびにかけていたねっくれすをわたしのくびにかけてくれた。',
  )
  expect(pieces[0]!.direction).toBe('')
})

it('旧形式の複数文にまたがる読みを文ごとに繰り返さず、元の指定は確認用に残す', () => {
  const text = '「こんにちは。さようなら」'
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody(text) }
  const settings = emptyNarration('w').settings
  settings.cues = [
    {
      id: 'old',
      episodeId: 'e',
      scope: 'range',
      refs: [{ blockId: 'b1', snapshot: text }],
      reading: 'こんにちは。さようなら',
    },
  ]
  const before = JSON.stringify(settings)
  expect(readingCuesNeedingReview(episode, settings).map((c) => c.id)).toEqual(['old'])
  expect(resolveSegments(episode, settings).map((s) => s.text)).toEqual([
    '「こんにちは。',
    'さようなら」',
  ])
  expect(JSON.stringify(settings)).toBe(before)
})
