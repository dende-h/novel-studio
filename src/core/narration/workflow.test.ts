import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { cueIsValid, openingSegments, resolveSegments, segmentFingerprint } from './resolve'
import { emptyNarration } from './types'

describe('文章選択と読み方', () => {
  it('台詞を一単位に保ち、話別スタイルと語句だけの読みを反映する', () => {
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
    expect(segments).toHaveLength(3)
    expect(segments[1]?.text).toBe('「やしろへ。帰ろう」')
    expect(segments[0]?.direction).toBe('静かに落ち着いて、言葉の余韻を大切に')
    expect(segments[1]?.direction).toContain('「社」の部分を')
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
