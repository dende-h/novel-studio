import type { Block } from '../schema'
export const NARRATION_PLANS = {
  trial: { label: '無料体験', limit: 500, model: 'drama-3' },
  basic: { label: '500円プラン', limit: 5000, model: 's2.1-pro' },
  standard: { label: '980円プラン', limit: 10000, model: 'drama-3' },
  plus: { label: '1,980円プラン', limit: 30000, model: 'drama-3' },
  premium: { label: '4,980円プラン', limit: 100000, model: 'drama-3' },
} as const
export type NarrationPlan = keyof typeof NARRATION_PLANS
export const STYLES = [
  {
    id: 'none',
    label: '声におまかせ',
    description: '声そのものの自然な読み方で。',
    direction: '',
    speed: 1,
    pause: 350,
  },
  {
    id: 'personal',
    label: '自然な一人語り',
    description: '主人公が語りかけるように。普段の速さ、控えめな抑揚。',
    direction: '主人公の視点で、自然に語りかけるように',
    speed: 1,
    pause: 400,
  },
  {
    id: 'bright',
    label: '明るく軽快',
    description: '明るい声で少し速めに。場面の間は短く。',
    direction: '明るく軽快に、親しみを込めて',
    speed: 1.05,
    pause: 250,
  },
  {
    id: 'quiet',
    label: '静かに余韻を残す',
    description: '落ち着いた声でゆっくり。場面の間を長めに。',
    direction: '静かに落ち着いて、言葉の余韻を大切に',
    speed: 0.95,
    pause: 700,
  },
] as const
export interface PronunciationEntry {
  id: string
  surface: string
  reading: string
  accent?: number
}
export interface VoiceProfile {
  id: string
  label: string
  description: string
  version: string
  sampleUrl?: string
}
export interface VoiceCue {
  id: string
  episodeId: string
  scope: 'episode' | 'scene' | 'range'
  refs: { blockId: string; snapshot: string; start?: number; end?: number }[]
  direction?: string
  voiceId?: string
  style?: string
  reading?: string
  speed?: number
  pauseMs?: number
}
export interface NarrationSettings {
  version: 1
  workId: string
  episodes?: Record<string, { style: string; narrator: string; mode?: 'solo' | 'cast' }>
  style: string
  narrator: string
  mode: 'solo' | 'cast'
  cast: Record<string, string>
  dictionary: PronunciationEntry[]
  cues: VoiceCue[]
}
export interface VoiceSegment {
  id: string
  episodeId: string
  blockId: string
  spanId: string
  source: Block
  text: string
  direction: string
  voiceId: string
  speed: number
  pauseMs: number
  characters: number
  fingerprint: string
}
export interface VoiceTake {
  id: string
  segmentId: string
  fingerprint: string
  jobId: string
  state: 'queued' | 'generating' | 'ready' | 'failed' | 'canceled' | 'unknown' | 'missing'
  error?: string
  createdAt: number
  expiresAt?: number
  duration?: number
}
export interface NarrationRecord {
  settings: NarrationSettings
  takes: VoiceTake[]
  accepted: Record<string, string>
  jobs: string[]
  candidates?: Record<string, string>
  candidateSegments?: Record<string, VoiceSegment>
  undoSnapshots?: Record<string, VoiceSegment[]>
  dismissed?: string[]
  snapshots?: Record<string, VoiceSegment[]>
  undo?: Record<string, string>
  operation?: { segments: VoiceSegment[]; jobs: string[]; whole: boolean; preview: boolean }
}
export interface Entitlement {
  plan: NarrationPlan
  label: string
  model: string
  limit: number
  used: number
  reserved: number
  remaining: number
  period: string
  periodEnd: number | null
  voices: VoiceProfile[]
  enabled: boolean
  development: boolean
  preview?: { remaining: number; limit: number; period: string }
}
export function emptyNarration(workId: string): NarrationRecord {
  return {
    settings: {
      version: 1,
      workId,
      style: 'none',
      narrator: 'default',
      mode: 'solo',
      cast: {},
      dictionary: [],
      cues: [],
    },
    takes: [],
    accepted: {},
    jobs: [],
  }
}
