/// <reference types="@cloudflare/workers-types" />

import { mp3Frames } from '../../src/core/narration/mp3'
import type { VoiceSegment } from '../../src/core/narration/types'
import { verifyUserId } from './_lib/auth'
import { decryptPart, encryptPart, importKey, sha256Hex } from './_lib/crypto'
import {
  entitlement,
  jobSchema,
  type NarrationEnv,
  publicTake,
  type TakeRow,
  validateSegments,
  voiceCatalog,
} from './_lib/narration'
import { verifyStaff } from './_lib/staff'

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  })
interface Job {
  id: string
  user_id: string
  work_id: string
  period: string
  request_hash: string
  dispatch_token: string
  created_at: number
  cancel_requested: number
}
interface Snapshot {
  segments: VoiceSegment[]
  voices: ReturnType<typeof voiceCatalog>
  model: string
}
const snapshotKey = (user: string, id: string) => `${user}/narration/${id}/snapshot`
const audioKey = (user: string, id: string) => `${user}/narration/audio/${id}`
async function dispatch(env: NarrationEnv, job: Job) {
  const response = await fetch(`${env.NARRATION_DISPATCH_URL}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: job.id, token: job.dispatch_token }),
  })
  if (!response.ok) throw new Error('dispatch')
}
export const onRequest: PagesFunction<NarrationEnv> = async (context) => {
  const { request, env } = context
  const url = new URL(request.url)
  if (url.searchParams.get('action') === 'run' && request.method === 'POST') {
    const job = await env.DB.prepare('SELECT * FROM narration_jobs WHERE id=? AND dispatch_token=?')
      .bind(
        url.searchParams.get('job'),
        request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '',
      )
      .first<Job>()
    if (!job) return reply({ error: '見つかりません' }, 404)
    return runNext(env, job)
  }
  const userId =
    env.NARRATION_RELEASE === '1'
      ? await verifyUserId(request, env)
      : await verifyStaff(request, env)
  if (!userId)
    return reply(
      { error: '朗読制作は現在、運営による検証中です。' },
      env.NARRATION_RELEASE === '1' ? 401 : 404,
    )
  try {
    const action = url.searchParams.get('action')
    if (request.method === 'GET' && action === 'audio') {
      const take = await env.DB.prepare(
        'SELECT t.* FROM narration_takes t JOIN narration_jobs j ON j.id=t.job_id WHERE t.id=? AND j.user_id=?',
      )
        .bind(url.searchParams.get('take'), userId)
        .first<TakeRow>()
      if (!take || take.state !== 'ready') return reply({ error: '音声が見つかりません。' }, 404)
      if ((take.expires_at ?? 0) < Date.now())
        return reply(
          { error: '保管期限を過ぎました。端末に保存した音声がなければ再生成が必要です。' },
          410,
        )
      const blob = await env.MEDIA.get(audioKey(userId, take.id))
      if (!blob) return reply({ error: '音声が見つかりません。再生成には文字枠を使います。' }, 410)
      return new Response(blob.body, {
        headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' },
      })
    }
    if (request.method === 'GET') {
      const access = await entitlement(env, userId),
        work = url.searchParams.get('work')
      if (!work) return reply({ entitlement: access, jobs: [], takes: [] })
      const jobs = (
        await env.DB.prepare(
          'SELECT * FROM narration_jobs WHERE user_id=? AND work_id=? ORDER BY created_at DESC LIMIT 100',
        )
          .bind(userId, work)
          .all<Job>()
      ).results
      const takes = (
        await env.DB.prepare(
          'SELECT t.* FROM narration_takes t JOIN narration_jobs j ON j.id=t.job_id WHERE j.user_id=? AND j.work_id=? ORDER BY t.created_at',
        )
          .bind(userId, work)
          .all<TakeRow>()
      ).results
      for (const job of jobs.filter((j) =>
        takes.some((t) => t.job_id === j.id && t.state === 'queued'),
      ))
        context.waitUntil(dispatch(env, job).catch(() => {}))
      return reply({
        entitlement: access,
        jobs: jobs.map((j) => j.id),
        takes: takes.map(publicTake),
      })
    }
    if (request.method === 'PATCH') {
      const { id } = (await request.json()) as { id: string }
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE narration_jobs SET cancel_requested=1 WHERE id=? AND user_id=?',
        ).bind(id, userId),
        env.DB.prepare(
          "UPDATE narration_takes SET state='canceled' WHERE job_id IN (SELECT id FROM narration_jobs WHERE id=? AND user_id=?) AND state='queued'",
        ).bind(id, userId),
      ])
      return reply({ ok: true })
    }
    if (request.method !== 'POST') return reply({ error: '対応していない操作です。' }, 405)
    const raw = await request.text()
    if (raw.length > 500_000) return reply({ error: '一度に送る原稿が長すぎます。' }, 413)
    const input = jobSchema.parse(JSON.parse(raw)),
      requestHash = await sha256Hex(raw)
    const existing = await env.DB.prepare('SELECT * FROM narration_jobs WHERE id=?')
      .bind(input.id)
      .first<Job>()
    if (existing) {
      if (existing.user_id !== userId || existing.request_hash !== requestHash)
        return reply({ error: '同じ操作の内容が一致しません。' }, 409)
      context.waitUntil(dispatch(env, existing).catch(() => {}))
      return reply({ id: existing.id })
    }
    const access = await entitlement(env, userId)
    if (!access.enabled)
      return reply({ error: '音声生成の準備が整っていません。設定は保存できます。' }, 503)
    const segments = validateSegments(input.segments, env, access.model)
    if (new Set(segments.map((s) => s.id)).size !== segments.length)
      return reply({ error: '同じ区間が重複しています。' }, 400)
    const total = segments.reduce((n, s) => n + s.characters, 0)
    if (total > access.remaining)
      return reply(
        {
          error: `残りは${access.remaining.toLocaleString()}文字です。生成範囲を短くしてください。`,
        },
        409,
      )
    const snapshot: Snapshot = { segments, voices: voiceCatalog(env), model: access.model }
    await env.MEDIA.put(
      snapshotKey(userId, input.id + '/' + requestHash),
      await encryptPart(
        JSON.stringify(snapshot),
        await importKey(env.ENCRYPTION_KEY),
        `${userId}:${input.id}:narration`,
      ),
    )
    const now = Date.now(),
      token = crypto.randomUUID()
    try {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO narration_daily(day,byte_limit) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET byte_limit=excluded.byte_limit',
        ).bind(
          Math.floor(now / 86400000),
          Math.max(0, Number(env.NARRATION_DAILY_BYTE_LIMIT ?? 1000000)),
        ),
        env.DB.prepare(
          'INSERT INTO narration_budgets(user_id,period,quota) VALUES(?,?,?) ON CONFLICT(user_id,period) DO UPDATE SET quota=excluded.quota',
        ).bind(userId, access.period, access.limit),
        env.DB.prepare(
          'INSERT INTO narration_jobs(id,user_id,work_id,period,request_hash,dispatch_token,created_at) VALUES(?,?,?,?,?,?,?)',
        ).bind(input.id, userId, input.workId, access.period, requestHash, token, now),
        ...segments.map((s) =>
          env.DB.prepare(
            'INSERT INTO narration_takes(id,job_id,segment_id,fingerprint,characters,input_bytes,model,created_at) VALUES(?,?,?,?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            input.id,
            s.id,
            s.fingerprint,
            s.characters,
            new TextEncoder().encode(providerText(s)).length,
            access.model,
            now,
          ),
        ),
      ])
    } catch {
      const raced = await env.DB.prepare(
        'SELECT * FROM narration_jobs WHERE id=? AND user_id=? AND request_hash=?',
      )
        .bind(input.id, userId, requestHash)
        .first<Job>()
      if (raced) return reply({ id: raced.id })
      return reply(
        { error: '文字枠を予約できませんでした。残り文字数を更新してお試しください。' },
        409,
      )
    }
    context.waitUntil(dispatch(env, { id: input.id, dispatch_token: token } as Job).catch(() => {}))
    return reply({ id: input.id }, 202)
  } catch {
    return reply(
      { error: '処理できませんでした。入力と通信を確認して、もう一度お試しください。' },
      400,
    )
  }
}
function providerText(segment: VoiceSegment) {
  return segment.direction ? `[${segment.direction}]${segment.text}` : segment.text
}
async function runNext(env: NarrationEnv, job: Job): Promise<Response> {
  await env.DB.prepare(
    "UPDATE narration_takes SET state='unknown',error='生成結果を確認できませんでした。文字枠は確認が終わるまで予約中になります。' WHERE job_id=? AND state='generating' AND started_at<?",
  )
    .bind(job.id, Date.now() - 180_000)
    .run()
  const candidate = await env.DB.prepare(
    "SELECT * FROM narration_takes WHERE job_id=? AND state='queued' ORDER BY created_at,id LIMIT 1",
  )
    .bind(job.id)
    .first<TakeRow>()
  if (!candidate || job.cancel_requested) return reply({ done: true })
  const now = Date.now()
  const locked = await env.DB.prepare(
    'UPDATE narration_lock SET take_id=?,until_ms=? WHERE id=1 AND until_ms<?',
  )
    .bind(candidate.id, now + 180_000, now)
    .run()
  if (!locked.meta.changes) return reply({ done: false })
  const claimed = await env.DB.prepare(
    "UPDATE narration_takes SET state='generating',started_at=? WHERE id=? AND state='queued' AND job_id IN (SELECT id FROM narration_jobs WHERE cancel_requested=0)",
  )
    .bind(now, candidate.id)
    .run()
  if (!claimed.meta.changes) {
    await env.DB.prepare('UPDATE narration_lock SET until_ms=0 WHERE take_id=?')
      .bind(candidate.id)
      .run()
    return reply({ done: false })
  }
  let sent = false
  try {
    const stored = await env.MEDIA.get(snapshotKey(job.user_id, job.id + '/' + job.request_hash))
    if (!stored) throw new Error('snapshot')
    const snapshot = JSON.parse(
      await decryptPart(
        new Uint8Array(await stored.arrayBuffer()),
        await importKey(env.ENCRYPTION_KEY),
        `${job.user_id}:${job.id}:narration`,
      ),
    ) as Snapshot
    const segment = snapshot.segments.find((s) => s.id === candidate.segment_id)
    const voice = segment && snapshot.voices.find((v) => v.id === segment.voiceId)
    if (!segment || !voice || !['s2.1-pro-free', 's2.1-pro', 'drama-3'].includes(snapshot.model))
      throw new Error('snapshot')
    if (
      snapshot.model !== 's2.1-pro-free' &&
      (env.NARRATION_RELEASE !== '1' || env.NARRATION_PAID_ENABLED !== '1')
    )
      throw new Error('paid-disabled')
    sent = true
    const result = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.FISH_AUDIO_API_KEY}`,
        'content-type': 'application/json',
        model: snapshot.model,
      },
      body: JSON.stringify({
        text: providerText(segment),
        reference_id: voice.referenceId,
        format: 'mp3',
        sample_rate: 44100,
        mp3_bitrate: 128,
        prosody: { speed: segment.speed, volume: 0, normalize_loudness: true },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!result.ok) {
      await env.DB.prepare(
        "UPDATE narration_takes SET state='failed',error=? WHERE id=? AND state='generating'",
      )
        .bind(
          result.status === 429
            ? '生成が混み合っています。時間をおいてお試しください。'
            : '音声を生成できませんでした。予約した文字枠は戻りました。',
          candidate.id,
        )
        .run()
      return reply({ done: false })
    }
    const audio = await result.arrayBuffer(),
      bytes = new Uint8Array(audio)
    if (
      bytes.length < 128 ||
      !(
        (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
        (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
      )
    )
      throw new Error('invalid-audio')
    try {
      mp3Frames(bytes)
    } catch {
      await env.DB.prepare(
        "UPDATE narration_takes SET state='failed',error='音声ファイルを確認できませんでした。文字枠は戻りました。' WHERE id=? AND state='generating'",
      )
        .bind(candidate.id)
        .run()
      return reply({ done: false })
    }
    await env.MEDIA.put(audioKey(job.user_id, candidate.id), audio, {
      httpMetadata: { contentType: 'audio/mpeg' },
    })
    await env.DB.prepare(
      "UPDATE narration_takes SET state='ready',expires_at=? WHERE id=? AND state='generating'",
    )
      .bind(Date.now() + 7 * 86400_000, candidate.id)
      .run()
  } catch {
    await env.DB.prepare(
      "UPDATE narration_takes SET state=?,error=? WHERE id=? AND state='generating'",
    )
      .bind(
        sent ? 'unknown' : 'failed',
        sent
          ? '生成結果を確認できませんでした。再送せず、予約枠を保留しています。'
          : '生成を開始できませんでした。文字枠は戻りました。',
        candidate.id,
      )
      .run()
  } finally {
    await env.DB.prepare('UPDATE narration_lock SET until_ms=0 WHERE take_id=?')
      .bind(candidate.id)
      .run()
  }
  return reply({ done: false })
}
