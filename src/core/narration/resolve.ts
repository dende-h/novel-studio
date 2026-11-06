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
      return block && locateRef(r, plainText(block.inlines)) !== null
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
    .map((c) => ({
      ...c,
      refs: c.refs.map(
        (r) =>
          locateRef(r, plainText(episode.blocks.find((b) => b.id === r.blockId)?.inlines ?? [])) ??
          r,
      ),
    }))
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
  generation?: { model: string; voices: { id: string; version: string }[]; legacy?: boolean },
): VoiceSegment[] {
  settings = { ...settings, ...settings.episodes?.[episode.id] }
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
    const pieces = generation?.legacy
      ? splitNarrationInlines(block.inlines)
      : splitSentences(block.inlines)
    let offset = 0
    return pieces.map((inlines, index) => {
      const start = offset
      offset += plainText(inlines).length
      const local = cues.filter(
        (c) =>
          c.scope === 'episode' ||
          c.refs.some(
            (r) =>
              r.blockId === block.id &&
              (r.start === undefined || (r.start < offset && (r.end ?? original.length) > start)),
          ),
      )
      const resolved = Object.assign(
        {},
        ...local.map((c) =>
          Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== '')),
        ),
      ) as Partial<VoiceCue>
      let text = spokenText(inlines, settings.dictionary)
      const readings = local
        .filter((c) => c.reading)
        .map((c) => ({
          c,
          r: c.refs.find(
            (r) =>
              r.blockId === block.id &&
              (r.start === undefined || (r.start < offset && (r.end ?? original.length) > start)),
          ),
        }))
      const wholeReading = readings.filter((v) => v.r?.start === undefined).at(-1)
      if (wholeReading) text = wholeReading.c.reading!
      const spans: { start: number; end: number; reading: string }[] = []
      for (const { c, r } of readings) {
        if (r?.start === undefined || r.end === undefined || r.start < start || r.end > offset)
          continue
        for (let i = spans.length - 1; i >= 0; i--)
          if (spans[i]!.start < r.end && spans[i]!.end > r.start) spans.splice(i, 1)
        spans.push({ start: r.start, end: r.end, reading: c.reading! })
      }
      if (spans.length) {
        let at = start
        text = ''
        for (const span of spans.sort((a, b) => a.start - b.start)) {
          text +=
            spokenText(sliceInlines(inlines, at - start, span.start - start), settings.dictionary) +
            span.reading
          at = span.end
        }
        text += spokenText(sliceInlines(inlines, at - start, offset - start), settings.dictionary)
      }
      const directionCue = local.filter((c) => c.direction).at(-1)
      const ref = directionCue?.refs.find(
        (r) =>
          r.blockId === block.id &&
          (r.start === undefined || (r.start < offset && (r.end ?? original.length) > start)),
      )
      const direction =
        ref?.start !== undefined && ref.end !== undefined && (ref.start > start || ref.end < offset)
          ? '「' +
            original.slice(Math.max(start, ref.start), Math.min(offset, ref.end)).slice(0, 40) +
            '」の部分を' +
            directionCue!.direction
          : (resolved.direction ?? style.direction)

      const part =
        pieces.length === 1
          ? segment
          : {
              ...segment,
              id: generation?.legacy
                ? `${episode.id}:${block.id}:part-${index + 1}`
                : `${episode.id}:${block.id}:sentence-${fingerprint(plainText(inlines))}-${pieces.slice(0, index).filter((v) => plainText(v) === plainText(inlines)).length}`,
              spanId: `part-${index + 1}`,
              source: { ...block, inlines },
              text: spokenText(inlines, settings.dictionary),
              characters: countCharacters(plainText(inlines)),
              pauseMs: index === pieces.length - 1 ? style.pause : 0,
            }
      return {
        ...part,
        text,
        direction,
        voiceId:
          resolved.voiceId ||
          (settings.mode === 'cast' && speaker ? settings.cast[speaker] : undefined) ||
          settings.narrator,
        speed: resolved.speed ?? style.speed,
        pauseMs: resolved.pauseMs ?? part.pauseMs,
        fingerprint: segmentFingerprint(
          {
            ...part,
            text,
            direction,
            voiceId:
              resolved.voiceId ||
              (settings.mode === 'cast' && speaker ? settings.cast[speaker] : undefined) ||
              settings.narrator,
            speed: resolved.speed ?? style.speed,
          },
          generation?.model,
          generation?.voices.find((v) => v.id === part.voiceId)?.version,
        ),
      }
    })
  })
}

/** Source offsets are UTF-16 DOM offsets; ruby/reference tokens remain atomic. */
export function sliceInlines(inlines: Inline[], start: number, end: number): Inline[] {
  let offset = 0
  return inlines.flatMap<Inline>((i) => {
    const length = plainText([i]).length,
      at = offset
    offset += length
    if (offset <= start || at >= end) return []
    if (i.type === 'text' || i.type === 'emphasisDots')
      return [{ ...i, text: i.text.slice(Math.max(0, start - at), Math.min(length, end - at)) }]
    if (start > at || end < offset)
      return [
        {
          type: 'text',
          text: plainText([i]).slice(Math.max(0, start - at), Math.min(length, end - at)),
        },
      ]
    return [i]
  })
}
export function splitSentences(inlines: Inline[]): Inline[][] {
  const text = plainText(inlines)
  const boundaries: number[] = []
  let quoted = 0
  for (let i = 0; i < text.length; i++) {
    if ('「『'.includes(text[i]!)) quoted++
    if ('」』'.includes(text[i]!)) {
      quoted = Math.max(0, quoted - 1)
      if (!quoted) boundaries.push(i + 1)
    } else if (!quoted && '。！？!?'.includes(text[i]!)) boundaries.push(i + 1)
  }
  let tokenOffset = 0
  for (const token of inlines) {
    const length = plainText([token]).length
    if (token.type === 'ruby' || token.type === 'ref') {
      for (let i = boundaries.length - 1; i >= 0; i--)
        if (boundaries[i]! > tokenOffset && boundaries[i]! < tokenOffset + length)
          boundaries.splice(i, 1)
    }
    tokenOffset += length
  }
  boundaries.push(text.length)
  let start = 0
  const result: Inline[][] = []
  for (const end of [...new Set(boundaries)]) {
    if (end > start) {
      const piece = sliceInlines(inlines, start, end)
      if (countCharacters(plainText(piece))) result.push(...splitNarrationInlines(piece))
    }
    start = end
  }
  return result.length ? result : [inlines]
}
export function openingSegments(segments: VoiceSegment[]): VoiceSegment[] {
  const result: VoiceSegment[] = []
  let count = 0
  for (const s of segments) {
    if (count && count + s.characters > 220) break
    if (s.characters > 300) break
    result.push(s)
    count += s.characters
    if (count >= 180 || result.length >= 30) break
  }
  return result
}

export function locateRef(
  ref: VoiceCue['refs'][number],
  text: string,
): VoiceCue['refs'][number] | null {
  if (text === ref.snapshot) return ref
  const fragment = ref.snapshot.slice(ref.start ?? 0, ref.end)
  if (!fragment) return null
  const at = text.indexOf(fragment)
  if (at < 0 || text.indexOf(fragment, at + 1) >= 0) return null
  return { ...ref, snapshot: text, start: at, end: at + fragment.length }
}
