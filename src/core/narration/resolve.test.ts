import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import {
  applyDictionary,
  countCharacters,
  cueIsValid,
  resolveSegments,
  spokenText,
} from './resolve'
import { emptyNarration } from './types'

describe('朗読の原稿と設定', () => {
  it('ルビ優先、長い辞書語優先、再帰置換なし、Unicodeの親文字で数える', () => {
    const blocks = parseEpisodeBody('｜東京《とうきょう》で東京都と東京。😀')
    const dictionary = [
      { id: '1', surface: '東京', reading: 'とうきょう' },
      { id: '2', surface: '東京都', reading: 'ときょうと' },
      { id: '3', surface: 'とうきょう', reading: '置換しない' },
    ]
    expect(spokenText(blocks[0]!.inlines, dictionary)).toBe(
      'とうきょうでときょうとととうきょう。😀',
    )
    expect(applyDictionary('東京都', dictionary)).toBe('ときょうと')
    expect(countCharacters('東京 \n😀')).toBe(3)
  })
  it('複数範囲を保存し、本文変更時は指定を別の台詞へ移さない', () => {
    const episode = {
      id: 'e',
      title: '話',
      blocks: parseEpisodeBody('こんにちは。\nありがとう。\nさようなら。'),
    }
    const settings = emptyNarration('w').settings
    settings.style = 'personal'
    settings.cues = [
      {
        id: 'a',
        episodeId: 'e',
        scope: 'range',
        refs: [{ blockId: 'b1', snapshot: 'こんにちは。' }],
        direction: '明るく',
      },
      {
        id: 'b',
        episodeId: 'e',
        scope: 'range',
        refs: [{ blockId: 'b3', snapshot: 'さようなら。' }],
        direction: '寂しく',
      },
    ]
    const before = JSON.stringify(episode)
    expect(resolveSegments(episode, settings).map((s) => s.direction)).toEqual([
      '明るく',
      '主人公の視点で、自然に語りかけるように',
      '寂しく',
    ])
    expect(JSON.stringify(episode)).toBe(before)
    const changed = {
      ...episode,
      blocks: parseEpisodeBody('違う台詞。\nありがとう。\nさようなら。'),
    }
    expect(cueIsValid(settings.cues[0]!, changed)).toBe(false)
    expect(resolveSegments(changed, settings)[0]?.direction).toBe(
      '主人公の視点で、自然に語りかけるように',
    )
  })
  it('間だけの変更では音声を失効させず、辞書変更は該当区間だけを失効させる', () => {
    const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('東京へ。\nさようなら。') }
    const settings = emptyNarration('w').settings
    const first = resolveSegments(episode, settings)
    settings.cues = [
      { id: 'a', episodeId: 'e', scope: 'episode', refs: [], direction: '', pauseMs: 1500 },
    ]
    expect(resolveSegments(episode, settings).map((s) => s.fingerprint)).toEqual(
      first.map((s) => s.fingerprint),
    )
    settings.dictionary = [{ id: '1', surface: '東京', reading: 'とうきょう' }]
    const next = resolveSegments(episode, settings)
    expect(next[0]?.fingerprint).not.toBe(first[0]?.fingerprint)
    expect(next[1]?.fingerprint).toBe(first[1]?.fingerprint)
  })
})

it('長い段落を句読点で分けても原文・ルビを保つ', () => {
  const episode = {
    id: 'long',
    title: '長文',
    blocks: parseEpisodeBody('｜東京《とうきょう》へ、私は歩いた。'.repeat(100)),
  }
  const pieces = resolveSegments(episode, emptyNarration('w').settings)
  expect(pieces.length).toBeGreaterThan(1)
  expect(pieces.every((s) => s.characters <= 800)).toBe(true)
  expect(pieces.map((s) => s.text).join('')).toBe('とうきょうへ、私は歩いた。'.repeat(100))
  expect(pieces.slice(0, -1).every((s) => s.pauseMs === 350)).toBe(true)
})
