import { edgeSilence, joinMp3 } from '@/core/narration/mp3'
import { plainText } from '@/core/narration/resolve'
import { MIN_SENTENCE_PAUSE_MS, type VoiceSegment, type VoiceTake } from '@/core/narration/types'
import type { NarrationService } from './service'

let silence: Promise<Uint8Array> | undefined
// Cache only small measurements, never decoded PCM for an entire book.
const edges = new Map<string, { leadingMs: number; trailingMs: number }>()
export async function assembleNarration(
  segments: VoiceSegment[],
  takes: VoiceTake[],
  service: NarrationService,
) {
  if (
    segments.length !== takes.length ||
    !segments.length ||
    takes.some((t, i) => t.state !== 'ready' || t.segmentId !== segments[i]?.id)
  )
    throw new Error('音声が揃っていません。生成結果を確認してください。')
  silence ??= fetch('/narration-samples/silence.mp3').then(async (r) => {
    if (!r.ok) throw new Error('音声の準備に失敗しました。')
    return new Uint8Array(await r.arrayBuffer())
  })
  const parts = []
  const decoder = new OfflineAudioContext(1, 1, 44100)
  for (const [i, take] of takes.entries()) {
    const data = new Uint8Array(await (await service.audio(take.id)).arrayBuffer())
    let measured = edges.get(take.id)
    if (!measured) {
      const decoded = await decoder.decodeAudioData(data.slice().buffer)
      measured = edgeSilence(
        Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
          decoded.getChannelData(channel),
        ),
        decoded.sampleRate,
      )
      if (edges.size >= 256) edges.delete(edges.keys().next().value!)
      edges.set(take.id, measured)
    }
    const segment = segments[i]!
    parts.push({
      data,
      ...measured,
      // Apply the same minimum to old saved sentence audio without regeneration.
      pauseMs: Math.max(
        /[。！？!?」』]\s*$/u.test(plainText(segment.source.inlines)) ? MIN_SENTENCE_PAUSE_MS : 0,
        segment.pauseMs,
      ),
    })
  }
  return joinMp3(parts, await silence)
}
