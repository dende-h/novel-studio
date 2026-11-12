import { z } from 'zod'
import { BlockSchema } from '../schema'
import type { NarrationRecord } from './types'

// Unknown fields survive backup round trips for forward compatibility.
const strings = z.record(z.string(), z.string())
const segment = z
  .object({
    id: z.string(),
    episodeId: z.string(),
    blockId: z.string(),
    spanId: z.string(),
    source: BlockSchema,
    text: z.string(),
    direction: z.string(),
    voiceId: z.string(),
    speed: z.number(),
    pauseMs: z.number(),
    characters: z.number(),
    fingerprint: z.string(),
    commaPause: z.literal('short').optional(),
  })
  .passthrough()
export const NarrationRecordSchema: z.ZodType<NarrationRecord> = z
  .object({
    settings: z
      .object({
        version: z.literal(1),
        workId: z.string(),
        style: z.string(),
        narrator: z.string(),
        mode: z.enum(['solo', 'cast']),
        cast: strings,
        episodes: z
          .record(
            z.string(),
            z
              .object({
                style: z.string(),
                narrator: z.string(),
                mode: z.enum(['solo', 'cast']).optional(),
              })
              .passthrough(),
          )
          .optional(),
        dictionary: z.array(
          z
            .object({
              id: z.string(),
              surface: z.string(),
              reading: z.string(),
              accent: z.number().optional(),
            })
            .passthrough(),
        ),
        cues: z.array(
          z
            .object({
              id: z.string(),
              episodeId: z.string(),
              scope: z.enum(['episode', 'scene', 'range']),
              refs: z.array(
                z
                  .object({
                    blockId: z.string(),
                    snapshot: z.string(),
                    start: z.number().optional(),
                    end: z.number().optional(),
                  })
                  .passthrough(),
              ),
              direction: z.string().optional(),
              voiceId: z.string().optional(),
              style: z.string().optional(),
              reading: z.string().optional(),
              speed: z.number().optional(),
              pauseMs: z.number().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    takes: z.array(
      z
        .object({
          id: z.string(),
          segmentId: z.string(),
          fingerprint: z.string(),
          jobId: z.string(),
          state: z.enum([
            'queued',
            'generating',
            'ready',
            'failed',
            'canceled',
            'unknown',
            'missing',
          ]),
          createdAt: z.number(),
          error: z.string().optional(),
          expiresAt: z.number().optional(),
          duration: z.number().optional(),
        })
        .passthrough(),
    ),
    accepted: strings,
    jobs: z.array(z.string()),
    candidates: strings.optional(),
    candidateSegments: z.record(z.string(), segment).optional(),
    snapshots: z.record(z.string(), z.array(segment)).optional(),
    undoSnapshots: z.record(z.string(), z.array(segment)).optional(),
    undo: strings.optional(),
    dismissed: z.array(z.string()).optional(),
    operation: z
      .object({
        segments: z.array(segment),
        jobs: z.array(z.string()),
        whole: z.boolean(),
        preview: z.boolean(),
      })
      .passthrough()
      .optional(),
    updatedAt: z.number().optional(),
  })
  .passthrough()

export const NarrationBackupSchema = z
  .object({
    record: NarrationRecordSchema,
    // Content-addressed MP3s, shared by cloud snapshots. Never embed base64 in sync JSON.
    audio: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
    pending: z.string().optional(),
    owner: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    for (const take of entry.record.takes)
      if (take.state === 'ready' && !entry.audio[take.id])
        ctx.addIssue({
          code: 'custom',
          message: '生成済み音声の参照がありません。',
          path: ['audio', take.id],
        })
    if (entry.pending) {
      try {
        const payload = JSON.parse(entry.pending)
        if (
          typeof payload.id !== 'string' ||
          payload.workId !== entry.record.settings.workId ||
          !Array.isArray(payload.segments)
        )
          throw new Error('invalid pending request')
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: '送信待ちの朗読を確認できませんでした。',
          path: ['pending'],
        })
      }
    }
  })
export type NarrationBackup = z.infer<typeof NarrationBackupSchema>
export const NARRATION_STORAGE_LIMIT = 5 * 1024 ** 3
export const NARRATION_AUDIO_MAX_BYTES = 8 * 1024 ** 2
export async function audioHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
