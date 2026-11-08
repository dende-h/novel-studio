// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { edgeSilence, joinMp3, mp3Frames } from './mp3'

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
    original.duration + (Math.ceil((0.7 * 44100) / 1152) * 1152) / 44100,
  )
})
it('切れた音声を完成扱いにしない', () => expect(() => mp3Frames(silence.slice(0, -10))).toThrow())

it('実際の無音を差し引き、句点の最低間だけを補う', () => {
  const duration = mp3Frames(silence).duration
  const assembled = joinMp3(
    [
      { data: silence, pauseMs: 350, trailingMs: 100 },
      { data: silence, pauseMs: 700, leadingMs: 150, trailingMs: 500 },
      { data: silence, pauseMs: 350, leadingMs: 300 },
    ],
    silence,
  )
  const added = (Math.ceil((0.1 * 44100) / 1152) * 1152) / 44100
  expect(assembled.timeline[1]!.start - duration).toBeCloseTo(added)
  // Already 800ms between the second and third recordings: no extra pause.
  expect(assembled.timeline[2]!.start - assembled.timeline[1]!.end).toBeCloseTo(0)
  expect(assembled.duration).toBeCloseTo(duration * 3 + added)
})

it('全チャンネルの端の無音だけを測り、語中の間や小さな声を切り取らない', () => {
  const a = new Float32Array(1000)
  const b = new Float32Array(1000)
  a[200] = 0.01
  a[800] = 0.005
  b[100] = 0.01
  expect(edgeSilence([a, b], 1000)).toEqual({ leadingMs: 100, trailingMs: 199 })
  expect(edgeSilence([new Float32Array(1000)], 1000)).toEqual({ leadingMs: 1000, trailingMs: 0 })
})
