import { joinMp3 } from '@/core/narration/mp3'
import type { VoiceSegment, VoiceTake } from '@/core/narration/types'
import type { NarrationService } from './service'

let silence: Promise<Uint8Array> | undefined
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
  for (const [i, take] of takes.entries())
    parts.push({
      data: new Uint8Array(await (await service.audio(take.id)).arrayBuffer()),
      pauseMs: segments[i]!.pauseMs,
    })
  return joinMp3(parts, await silence)
}
