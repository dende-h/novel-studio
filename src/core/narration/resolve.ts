import type { Staging } from '../game'
import type { Episode, Inline } from '../schema'
import { fingerprint } from './fingerprint'
import {
  type NarrationSettings,
  type PronunciationEntry,
  STYLES,
  type VoiceCue,
  type VoiceSegment,
} from './types'
export function plainText(inlines: Inline[]): string {
  return inlines
    .map((i) =>
      i.type === 'ruby'
        ? i.base
        : i.type === 'ref'
          ? i.children
            ? plainText(i.children)
            : i.name
          : i.text,
    )
    .join('')
}
export function countCharacters(text: string): number {
  return [...text.replace(/\s/gu, '')].length
}
export function applyDictionary(text: string, entries: PronunciationEntry[]): string {
  const sorted = entries
    .filter((e) => e.surface && e.reading)
    .sort((a, b) => b.surface.length - a.surface.length)
  let result = ''
  for (let at = 0; at < text.length; ) {
    const entry = sorted.find((e) => text.startsWith(e.surface, at))
    if (entry) {
      result += entry.reading
      at += entry.surface.length
    } else {
      result += text[at]
      at++
    }
  }
  return result
}
export function spokenText(inlines: Inline[], entries: PronunciationEntry[]): string {
  return inlines
    .map((i) =>
      i.type === 'ruby'
        ? i.reading
        : i.type === 'ref'
          ? i.children
            ? spokenText(i.children, entries)
            : applyDictionary(i.name, entries)
          : applyDictionary(i.text, entries),
    )
    .join('')
}
export function cueIsValid(cue: VoiceCue, episode: Episode): boolean {
  return (
    cue.scope === 'episode' ||
    cue.refs.every((r) => {
      const block = episode.blocks.find((b) => b.id === r.blockId)
      return block && plainText(block.inlines) === r.snapshot
    })
  )
}
export function cuesForBlock(
  settings: NarrationSettings,
  episode: Episode,
  blockId: string,
): VoiceCue[] {
  return settings.cues
    .filter(
      (c) =>
        c.episodeId === episode.id &&
        cueIsValid(c, episode) &&
        (c.scope === 'episode' || c.refs.some((r) => r.blockId === blockId)),
    )
    .sort(
      (a, b) =>
        ({ episode: 0, scene: 1, range: 2 })[a.scope] - { episode: 0, scene: 1, range: 2 }[b.scope],
    )
}
export function segmentFingerprint(
  segment: Omit<VoiceSegment, 'fingerprint'>,
  model = '',
  voiceVersion = '',
): string {
  return fingerprint(
    JSON.stringify([
      1,
      segment.text,
      segment.direction,
      segment.voiceId,
      segment.speed,
      'mp3-44100-128',
      model,
      voiceVersion,
    ]),
  )
}
/** Split only at Japanese/Latin punctuation; keep ruby and reference tokens atomic. */
export function splitNarrationInlines(inlines: Inline[], limit = 600): Inline[][] {
  if (countCharacters(plainText(inlines)) <= limit) return [inlines]
  const tokens = inlines.flatMap<Inline>((i) =>
    i.type === 'text' || i.type === 'emphasisDots'
      ? (i.text.match(/[^。！？!?、,]+[。！？!?、,]*|[。！？!?、,]+/gu) ?? []).map((text) => ({
          ...i,
          text,
        }))
      : [i],
  )
  const parts: Inline[][] = []
  let current: Inline[] = []
  for (const token of tokens) {
    if (current.length && countCharacters(plainText([...current, token])) > limit) {
      parts.push(current)
      current = []
    }
    current.push(token)
  }
  if (current.length) parts.push(current)
  return parts
}
export function resolveSegments(
  episode: Episode,
  settings: NarrationSettings,
  staging?: Staging,
  generation?: { model: string; voices: { id: string; version: string }[] },
): VoiceSegment[] {
  const style = STYLES.find((s) => s.id === settings.style) ?? STYLES[0]
  return episode.blocks.flatMap((block) => {
    const original = plainText(block.inlines)
    if (!countCharacters(original)) return []
    const cues = cuesForBlock(settings, episode, block.id)
    const override = Object.assign(
      {},
      ...cues.map((c) =>
        Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== '')),
      ),
    ) as Partial<VoiceCue>
    const speaker = staging?.cues.find((c) => c.blockId === block.id)?.speaker
    const segment: Omit<VoiceSegment, 'fingerprint'> = {
      id: `${episode.id}:${block.id}:whole`,
      episodeId: episode.id,
      blockId: block.id,
      spanId: 'whole',
      source: block,
      text: override.reading || spokenText(block.inlines, settings.dictionary),
      direction: override.direction ?? style.direction,
      voiceId:
        override.voiceId ||
        (settings.mode === 'cast' && speaker ? settings.cast[speaker] : undefined) ||
        settings.narrator,
      speed: override.speed ?? style.speed,
      pauseMs:
        override.pauseMs ??
        (staging?.cues.find((c) => c.blockId === block.id)?.sceneBreak
          ? style.pause * 2
          : style.pause),
      characters: countCharacters(original),
    }
    const pieces = override.reading ? [block.inlines] : splitNarrationInlines(block.inlines)
    return pieces.map((inlines, index) => {
      const part =
        pieces.length === 1
          ? segment
          : {
              ...segment,
              id: `${episode.id}:${block.id}:part-${index + 1}`,
              spanId: `part-${index + 1}`,
              source: { ...block, inlines },
              text: spokenText(inlines, settings.dictionary),
              characters: countCharacters(plainText(inlines)),
              pauseMs: index === pieces.length - 1 ? segment.pauseMs : 0,
            }
      return {
        ...part,
        fingerprint: segmentFingerprint(
          part,
          generation?.model,
          generation?.voices.find((v) => v.id === part.voiceId)?.version,
        ),
      }
    })
  })
}
