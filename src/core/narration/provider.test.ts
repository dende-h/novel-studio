import { expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { providerText } from './provider'
import { resolveSegments, segmentFingerprint } from './resolve'
import { emptyNarration } from './types'

it('新しい生成には読点の間を挿入せず、原文と消費文字数を保つ', () => {
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('朝、 風が吹いた。') }
  const settings = emptyNarration('w').settings
  const [segment] = resolveSegments(episode, settings)
  expect(segment!.commaPause).toBeUndefined()
  expect(providerText(segment!)).toBe('朝、 風が吹いた。')
  expect(segment!.characters).toBe(8)
  expect(segment!.pauseMs).toBe(350)
  expect(segmentFingerprint(segment!)).toBe(segment!.fingerprint)
  settings.cues = [
    { id: 'c', episodeId: 'e', scope: 'episode', refs: [], direction: '間を空けず、早口で' },
  ]
  const [directed] = resolveSegments(episode, settings)
  expect(directed!.commaPause).toBeUndefined()
  expect(providerText(directed!)).toBe('[間を空けず、早口で]朝、 風が吹いた。')
})
it('旧バージョンから送信済みの読点補正要求は互換性を保つ', () => {
  expect(providerText({ text: '朝、、風が吹いた、。', direction: '', commaPause: 'short' })).toBe(
    '朝、、[short pause]風が吹いた、。',
  )
})
