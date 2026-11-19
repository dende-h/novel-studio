/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod'
import { countCharacters, plainText, segmentFingerprint } from '../../../src/core/narration/resolve'
import {
  type Entitlement,
  NARRATION_BILLING_PLANS,
  NARRATION_PAID_MODELS,
  NARRATION_PLANS,
  type NarrationAllowance,
  type NarrationPlan,
  type VoiceSegment,
} from '../../../src/core/narration/types'
import { BlockSchema } from '../../../src/core/schema'
import type { ClerkEnv } from './auth'
import { readProfile } from './board-store'
import { readSubscription } from './membership'
import licensedJapaneseVoices from './narration-voices.json'
export interface NarrationEnv extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
  FISH_AUDIO_API_KEY: string
  FISH_NARRATION_VOICE_ID?: string
  NARRATION_VOICES?: string
  NARRATION_JAPANESE_CATALOG?: string
  NARRATION_DAILY_BYTE_LIMIT?: string
  NARRATION_PREVIEW_LIMIT?: string
  NARRATION_STAFF_TEST_PLAN?: string
  NARRATION_OPERATOR_USER_ID?: string
  NARRATION_RELEASE?: string
  NARRATION_PAID_ENABLED?: string
  NARRATION_DISPATCH_URL?: string
  STRIPE_PRICE_MONTHLY?: string
  STRIPE_PRICE_YEARLY?: string
  NARRATION_PRICE_STANDARD?: string
  NARRATION_PRICE_PLUS?: string
  NARRATION_PRICE_PREMIUM?: string
}
export function voiceCatalog(env: NarrationEnv) {
  const schema = z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string(),
      version: z.string(),
      referenceId: z.string().regex(/^[a-f0-9]{32}$/),
      sampleUrl: z.string().startsWith('/narration-samples/').optional(),
    }),
  )
  const voices = env.NARRATION_VOICES ? schema.parse(JSON.parse(env.NARRATION_VOICES)) : []
  if (new Set(voices.map((voice) => voice.id)).size !== voices.length)
    throw new Error('Duplicate narration voice ID')
  if (!voices.some((voice) => voice.id === 'default') && env.FISH_NARRATION_VOICE_ID) {
    voices.unshift(
      ...schema.parse([
        {
          id: 'default',
          label: 'Shiori',
          description: '設定済みの日本語の声',
          version: '1',
          referenceId: env.FISH_NARRATION_VOICE_ID,
        },
      ]),
    )
  }
  if (env.NARRATION_JAPANESE_CATALOG === '1') {
    for (const voice of licensedJapaneseVoices) {
      if (voice.availableUntil && Date.parse(voice.availableUntil) <= Date.now()) continue
      const existing = voices.find((item) => item.referenceId === voice.referenceId)
      if (existing) {
        existing.sampleUrl ??= voice.sampleUrl
      } else if (!voices.some((item) => item.id === voice.id)) {
        voices.push(voice)
      }
    }
  }
  return voices
}
function staffTestPlan(env: NarrationEnv): NarrationPlan | undefined {
  const plan = env.NARRATION_STAFF_TEST_PLAN
  if (env.NARRATION_RELEASE !== '1' && plan && Object.hasOwn(NARRATION_PLANS, plan))
    return plan as NarrationPlan
}

export function paidNarrationEnabled(env: NarrationEnv): boolean {
  return (
    env.NARRATION_PAID_ENABLED === '1' &&
    (env.NARRATION_RELEASE === '1' || staffTestPlan(env) !== undefined)
  )
}

export async function entitlement(
  env: NarrationEnv,
  userId: string,
  now = Date.now(),
): Promise<Entitlement> {
  const subscription = await readSubscription(env.DB, userId)
  let plan: NarrationPlan = 'trial'
  if (
    subscription &&
    ['active', 'trialing'].includes(subscription.status) &&
    subscription.current_period_end > now
  ) {
    const price = subscription.price_id
    if (price && price === env.NARRATION_PRICE_PREMIUM) plan = 'premium'
    else if (price && price === env.NARRATION_PRICE_PLUS) plan = 'plus'
    else if (price && price === env.NARRATION_PRICE_STANDARD) plan = 'standard'
    else if (price && [env.STRIPE_PRICE_MONTHLY, env.STRIPE_PRICE_YEARLY].includes(price))
      plan = 'basic'
  }
  const development = env.NARRATION_RELEASE !== '1'
  const operator =
    !development && env.NARRATION_OPERATOR_USER_ID === userId
      ? await readProfile(env.DB, userId)
      : null
  const operatorPremium = operator?.role === 'staff' && operator.deleted_at === 0
  if (operatorPremium) plan = 'premium'
  const testPlan = staffTestPlan(env)
  if (testPlan) plan = testPlan
  const definition = NARRATION_PLANS[plan]
  const model = development && !testPlan ? 's2.1-pro-free' : definition.model
  // Calendar months in JST also give annual subscribers monthly narration allowances.
  const date = new Date(now + 9 * 3600_000)
  const month = date.toISOString().slice(0, 7)
  const period = plan === 'trial' ? 'trial' : month
  const budgetPeriod = testPlan ? 'staff:' + testPlan + ':' + period : period
  const periodEnd =
    plan === 'trial'
      ? null
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 9 * 3600_000
  const budget = await env.DB.prepare(
    'SELECT used+extra_used AS used,reserved+extra_reserved AS reserved FROM narration_budgets WHERE user_id=? AND period=?',
  )
    .bind(userId, budgetPeriod)
    .first<{ used: number; reserved: number }>()
  const canChooseModel =
    model === 'drama-3' && NARRATION_BILLING_PLANS.some((tier) => tier === plan)
  const unitQuota = definition.limit * (canChooseModel ? 2 : 1)
  const used = budget?.used ?? 0
  const reserved = budget?.reserved ?? 0
  const allowance = (unitsPerCharacter: number): NarrationAllowance => ({
    limit: Math.floor(unitQuota / unitsPerCharacter),
    used: Math.floor(used / unitsPerCharacter),
    reserved: Math.floor(reserved / unitsPerCharacter),
    remaining: Math.floor(Math.max(0, unitQuota - used - reserved) / unitsPerCharacter),
  })
  const modelAllowances = canChooseModel
    ? { 'drama-3': allowance(2), 's2.1-pro': allowance(1) }
    : undefined
  const previewPeriod =
    'preview:' + date.toISOString().slice(0, 10) + (testPlan ? ':staff:' + testPlan : '')
  const previewLimit = Math.max(
    0,
    Math.min(
      100,
      Number(env.NARRATION_PREVIEW_LIMIT ?? (env.NARRATION_RELEASE === '1' ? 0 : 5)) || 0,
    ),
  )
  const previewBudget = await env.DB.prepare(
    'SELECT used,reserved FROM narration_budgets WHERE user_id=? AND period=?',
  )
    .bind(userId, previewPeriod)
    .first<{ used: number; reserved: number }>()
  return {
    preview: {
      limit: previewLimit,
      remaining: Math.max(
        0,
        previewLimit - (previewBudget?.used ?? 0) - (previewBudget?.reserved ?? 0),
      ),
      period: previewPeriod,
    },
    plan,
    label: operatorPremium ? '運営・プレミアム' : definition.label,
    model,
    ...(modelAllowances?.['drama-3'] ?? allowance(1)),
    modelAllowances,
    unitQuota,
    period: budgetPeriod,
    periodEnd,
    voices: voiceCatalog(env).map(({ id, label, description, version, sampleUrl }) => ({
      id,
      label,
      description,
      version,
      sampleUrl,
    })),
    development,
    enabled:
      !!env.FISH_AUDIO_API_KEY &&
      !!env.NARRATION_DISPATCH_URL &&
      voiceCatalog(env).length > 0 &&
      (!env.NARRATION_STAFF_TEST_PLAN || !development || !!testPlan) &&
      (model === 's2.1-pro-free' || paidNarrationEnabled(env)),
  }
}
export const segmentSchema = z.object({
  id: z.string().min(1).max(200),
  episodeId: z.string().min(1).max(100),
  blockId: z.string().min(1).max(100),
  spanId: z.string().regex(/^(whole|part-[1-9][0-9]*)$/),
  source: BlockSchema,
  text: z.string().min(1).max(3000),
  direction: z.string().max(240),
  voiceId: z.string().max(100),
  speed: z.number().min(0.8).max(1.2),
  pauseMs: z.number().int().min(0).max(3000),
  commaPause: z.literal('short').optional(),
})
export const jobSchema = z.object({
  id: z.string().uuid(),
  workId: z.string().min(1).max(100),
  preview: z.boolean().optional(),
  model: z.enum(NARRATION_PAID_MODELS).optional(),
  segments: z.array(segmentSchema).min(1).max(500),
})
export function validateSegments(
  input: z.infer<typeof jobSchema>['segments'],
  env: NarrationEnv,
  model = '',
): VoiceSegment[] {
  const voices = voiceCatalog(env)
  return input.map((segment) => {
    const characters = countCharacters(plainText(segment.source.inlines))
    if (!characters || characters > 800 || !voices.some((v) => v.id === segment.voiceId))
      throw new Error('区間は800文字以内で、用意された声を選んでください。')
    if (countCharacters(segment.text) > Math.max(120, characters * 8))
      throw new Error('読みの指定が長すぎます。短くしてお試しください。')
    // Prevent raw provider control tags from escaping the author text/direction boundary.
    if (/[<>[\]]/.test(segment.direction) || /<\||\|>/.test(segment.text))
      throw new Error('演技指示はタグを使わず、普段の言葉で入力してください。')
    return {
      ...segment,
      characters,
      fingerprint: segmentFingerprint(
        { ...segment, characters },
        model,
        voices.find((v) => v.id === segment.voiceId)?.version,
      ),
    }
  })
}
export interface TakeRow {
  id: string
  job_id: string
  segment_id: string
  fingerprint: string
  state: string
  characters: number
  input_bytes: number
  model: string
  created_at: number
  started_at: number | null
  expires_at: number | null
  error: string | null
}
export function publicTake(t: TakeRow) {
  return {
    id: t.id,
    jobId: t.job_id,
    segmentId: t.segment_id,
    model: t.model,
    fingerprint: t.fingerprint,
    state: t.state,
    createdAt: t.created_at,
    expiresAt: t.expires_at ?? undefined,
    error: t.error ?? undefined,
  }
}
