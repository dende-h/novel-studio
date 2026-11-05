// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { joinMp3, mp3Frames } from './mp3'

const silence = new Uint8Array(
  readFileSync(new URL('../../../public/narration-samples/silence.mp3', import.meta.url)),
)
it('複数音声と無音の間を同じ順番・時間で結合する', () => {
  const original = mp3Frames(silence)
  const joined = joinMp3(
    [
      { data: silence, pauseMs: 700 },
      { data: silence, pauseMs: 0 },
    ],
    silence,
  )
  expect(mp3Frames(joined.data).duration).toBeCloseTo(joined.duration)
  expect(joined.timeline[1]?.start).toBeCloseTo(
    original.duration + (Math.round((0.7 * 44100) / 1152) * 1152) / 44100,
  )
})
it('切れた音声を完成扱いにしない', () => expect(() => mp3Frames(silence.slice(0, -10))).toThrow())
