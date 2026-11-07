import { expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { providerText } from './provider'
import { resolveSegments, segmentFingerprint } from './resolve'
import { emptyNarration } from './types'

it('指定のない読点にだけ短い間を足し、原文と消費文字数を保つ', () => {
  const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('朝、 風が吹いた。') }
  const settings = emptyNarration('w').settings
  const [segment] = resolveSegments(episode, settings)
  expect(segment!.commaPause).toBe('short')
  expect(providerText(segment!)).toBe('朝、[short pause] 風が吹いた。')
  expect(segment!.text).toBe('朝、 風が吹いた。')
  expect(segment!.characters).toBe(8)
  const { commaPause: _, ...legacy } = segment!
  expect(providerText(legacy)).toBe(legacy.text)
  expect(segmentFingerprint(legacy)).not.toBe(segment!.fingerprint)
  settings.cues = [
    { id: 'c', episodeId: 'e', scope: 'episode', refs: [], direction: '間を空けず、早口で' },
  ]
  const [directed] = resolveSegments(episode, settings)
  expect(directed!.commaPause).toBeUndefined()
  expect(providerText(directed!)).toBe('[間を空けず、早口で]朝、 風が吹いた。')
})
it('読点の連続・文末では余分な間を重ねない', () => {
  expect(providerText({ text: '朝、、風が吹いた、。', direction: '', commaPause: 'short' })).toBe(
    '朝、、[short pause]風が吹いた、。',
  )
})
