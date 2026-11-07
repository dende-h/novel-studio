import type { VoiceSegment } from './types'

/** Keep source text and character billing untouched; only provider input carries pauses. */
export function providerText(
  segment: Pick<VoiceSegment, 'text' | 'direction' | 'commaPause'>,
): string {
  const text =
    segment.commaPause === 'short' && !segment.direction.trim()
      ? segment.text.replace(/、(?=\s*[^、。！？!?\s])/gu, '、[short pause]')
      : segment.text
  return segment.direction ? '[' + segment.direction + ']' + text : text
}
