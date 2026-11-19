// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerText } from '../../src/core/narration/provider'
import { resolveSegments } from '../../src/core/narration/resolve'
import { emptyNarration } from '../../src/core/narration/types'
import { parseEpisodeBody } from '../../src/core/parser/parseNotation'
import { verifyUserId } from './_lib/auth'
import { entitlement, jobSchema, type NarrationEnv, validateSegments } from './_lib/narration'
import { verifyStaff } from './_lib/staff'
import { makeRealD1 } from './board/real-d1'
import { onRequest } from './narration'

vi.mock('./_lib/staff', () => ({ verifyStaff: vi.fn(async () => 'user') }))
vi.mock('./_lib/auth', () => ({ verifyUserId: vi.fn(async () => 'user') }))
const ddl = readFileSync(new URL('../../migrations/0011_narration.sql', import.meta.url), 'utf8')
const sharedQuota = readFileSync(
  new URL('../../migrations/0013_narration_shared_quota.sql', import.meta.url),
  'utf8',
)
function setup(migrate = true) {
  const real = makeRealD1()
  real.exec(
    readFileSync(new URL('../../migrations/0005_subscriptions.sql', import.meta.url), 'utf8'),
  )
  real.exec(ddl)
  if (migrate) real.exec(sharedQuota)
  const batch = real.db.batch.bind(real.db)
  let tail = Promise.resolve()
  real.db.batch = (statements) => {
    const run = tail.then(async () => {
      real.exec('BEGIN')
      try {
        const result = await batch(statements)
        real.exec('COMMIT')
        return result
      } catch (e) {
        real.exec('ROLLBACK')
        throw e
      }
    })
    tail = run.then(
      () => {},
      () => {},
    )
    return run
  }
  const objects = new Map<string, Uint8Array>()
  const env = {
    DB: real.db,
    MEDIA: {
      put: vi.fn(async (k: string, v: Uint8Array) => objects.set(k, v)),
      get: vi.fn(async (k: string) => {
        const v = objects.get(k)
        return v ? { arrayBuffer: async () => v.buffer, body: v } : null
      }),
    },
    ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
    FISH_AUDIO_API_KEY: 'test',
    FISH_NARRATION_VOICE_ID: '5da7f24e9e274f91b2b677669c818ce9',
    NARRATION_DISPATCH_URL: 'https://dispatcher.example',
  } as unknown as NarrationEnv
  return { real, env, objects }
}
function call(env: NarrationEnv, body?: unknown, query = '') {
  return onRequest({
    env,
    request: new Request(
      'https://app.example/api/narration' + query,
      body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
    ),
    waitUntil: () => {},
  } as Parameters<typeof onRequest>[0])
}
function payload(id = crypto.randomUUID()) {
  return {
    id,
    workId: 'w',
    segments: resolveSegments(
      { id: 'e', title: '話', blocks: parseEpisodeBody('こんにちは。') },
      emptyNarration('w').settings,
    ),
  }
}
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  ),
)
describe('朗読APIの文字枠・所有権', () => {
  it('初回枠を表示し、同じジョブの再送で枠を二重予約しない', async () => {
    const { real, env } = setup()
    const body = payload()
    expect((await call(env, body)).status).toBe(202)
    expect((await call(env, body)).status).toBe(200)
    expect(real.rows('SELECT * FROM narration_jobs')).toHaveLength(1)
    expect(await entitlement(env, 'user')).toMatchObject({
      limit: 500,
      reserved: 6,
      remaining: 494,
      model: 's2.1-pro-free',
    })
    real.close()
  })
  it('並列要求でも上限を超えず、失敗時は一度だけ返却する', async () => {
    const { real, env } = setup()
    const make = () => ({
      ...payload(),
      segments: resolveSegments(
        { id: 'e', title: '話', blocks: parseEpisodeBody('あ'.repeat(300)) },
        emptyNarration('w').settings,
      ),
    })
    const responses = await Promise.all([call(env, make()), call(env, make())])
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409])
    real.exec("UPDATE narration_takes SET state='failed'")
    real.exec("UPDATE narration_takes SET state='failed'")
    expect(await entitlement(env, 'user')).toMatchObject({ used: 0, reserved: 0 })
    real.close()
  })
  it('別所有者のジョブIDと音声を返さない', async () => {
    const { real, env } = setup()
    const body = payload()
    await call(env, body)
    real.exec("UPDATE narration_jobs SET user_id='other'")
    expect((await call(env, body)).status).toBe(409)
    const rows = real.rows<{ id: string }>('SELECT id FROM narration_takes')
    expect((await call(env, undefined, '?action=audio&take=' + rows[0]?.id)).status).toBe(404)
    real.close()
  })
  it('結果不明は予約を保留し、後日成功が確認されても一度だけ確定する', async () => {
    const { real, env } = setup()
    await call(env, payload())
    real.exec("UPDATE narration_takes SET state='generating'")
    real.exec("UPDATE narration_takes SET state='unknown'")
    expect(await entitlement(env, 'user')).toMatchObject({ used: 0, reserved: 6 })
    real.exec("UPDATE narration_takes SET state='ready'")
    expect(await entitlement(env, 'user')).toMatchObject({ used: 6, reserved: 0 })
    real.close()
  })
})

async function runJob(env: NarrationEnv, job: { id: string; dispatch_token: string }) {
  return onRequest({
    env,
    request: new Request('https://app.example/api/narration?action=run&job=' + job.id, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + job.dispatch_token },
    }),
    waitUntil: () => {},
  } as Parameters<typeof onRequest>[0])
}
it('無料モデルだけを呼び出し、成功した区間は一度だけ確定する', async () => {
  const { real, env } = setup()
  const body = payload()
  await call(env, body)
  const job = real.row<{ id: string; dispatch_token: string }>(
    'SELECT id,dispatch_token FROM narration_jobs',
  )!
  const provider = vi.fn(
    async () =>
      new Response(
        readFileSync(new URL('../../public/narration-samples/silence.mp3', import.meta.url)),
        { headers: { 'content-type': 'audio/mpeg' } },
      ),
  )
  vi.stubGlobal('fetch', provider)
  await runJob(env, job)
  expect(await entitlement(env, 'user')).toMatchObject({ used: 6, reserved: 0 })
  expect(provider).toHaveBeenCalledTimes(1)
  expect((provider.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({
    model: 's2.1-pro-free',
  })
  await runJob(env, job)
  expect(provider).toHaveBeenCalledTimes(1)
  real.close()
})
it('結果不明のプロバイダー要求を再送せず、以前の成功音声も消さない', async () => {
  const { real, env } = setup()
  await call(env, payload())
  const job = real.row<{ id: string; dispatch_token: string }>(
    'SELECT id,dispatch_token FROM narration_jobs',
  )!
  const provider = vi.fn(async () => {
    throw new Error('timeout')
  })
  vi.stubGlobal('fetch', provider)
  await runJob(env, job)
  await runJob(env, job)
  expect(provider).toHaveBeenCalledTimes(1)
  expect(real.row<{ state: string }>('SELECT state FROM narration_takes')?.state).toBe('unknown')
  expect(await entitlement(env, 'user')).toMatchObject({ used: 0, reserved: 6 })
  real.close()
})
it('日次の原価上限ではプロバイダーも実行担当も呼ばない', async () => {
  const { real, env } = setup()
  env.NARRATION_DAILY_BYTE_LIMIT = '0'
  expect((await call(env, payload())).status).toBe(409)
  expect(real.rows('SELECT * FROM narration_jobs')).toHaveLength(0)
  expect(fetch).not.toHaveBeenCalled()
  real.close()
})
it('年額会員にもJST月次枠を付け、予約は元の月に残す', async () => {
  const { real, env } = setup()
  env.STRIPE_PRICE_YEARLY = 'annual'
  const before = Date.UTC(2026, 10, 30, 14, 59, 59)
  real.insert('subscriptions', {
    user_id: 'user',
    stripe_customer_id: 'c',
    stripe_subscription_id: 's',
    status: 'active',
    price_id: 'annual',
    current_period_end: before + 365 * 86400000,
    grace_until: 0,
    updated_at: before,
  })
  expect(await entitlement(env, 'user', before)).toMatchObject({
    plan: 'basic',
    limit: 7500,
    period: '2026-11',
  })
  expect(await entitlement(env, 'user', before + 1000)).toMatchObject({
    plan: 'basic',
    limit: 7500,
    period: '2026-12',
  })
  real.close()
})

it('スタイル試聴は文字枠を消費せず、日次回数を原子的に予約する', async () => {
  const { real, env } = setup()
  env.NARRATION_PREVIEW_LIMIT = '1'
  const responses = await Promise.all([
    call(env, { ...payload(), preview: true }),
    call(env, { ...payload(), preview: true }),
  ])
  expect(responses.map((r) => r.status).sort()).toEqual([202, 409])
  expect(await entitlement(env, 'user')).toMatchObject({
    used: 0,
    reserved: 0,
    remaining: 500,
    preview: { remaining: 0, limit: 1 },
  })
  real.exec("UPDATE narration_takes SET state='ready'")
  expect(await entitlement(env, 'user')).toMatchObject({
    used: 0,
    reserved: 0,
    remaining: 500,
    preview: { remaining: 0 },
  })
  real.close()
})
it('試聴に長文を送って通常枠を迂回できない', async () => {
  const { real, env } = setup()
  const body = {
    ...payload(),
    preview: true,
    segments: resolveSegments(
      { id: 'e', title: '話', blocks: parseEpisodeBody('あ'.repeat(301)) },
      emptyNarration('w').settings,
    ),
  }
  expect((await call(env, body)).status).toBe(400)
  expect(real.rows('SELECT * FROM narration_jobs')).toHaveLength(0)
  real.close()
})

it.each([
  false,
  true,
])('新規の読点補正は無効、旧要求は互換性を保ち、文字枠は原文で数える（旧要求=%s）', async (legacy) => {
  const { real, env } = setup()
  const body = {
    ...payload(),
    segments: resolveSegments(
      { id: 'e', title: '話', blocks: parseEpisodeBody('朝、風が吹いた。') },
      emptyNarration('w').settings,
    ),
  }
  if (legacy) body.segments[0]!.commaPause = 'short'
  const parsed = jobSchema.parse(body)
  const validated = validateSegments(parsed.segments, env, 's2.1-pro-free')
  expect(validated[0]?.commaPause).toBe(legacy ? 'short' : undefined)
  expect(providerText(validated[0]!)).toBe(
    legacy ? '朝、[short pause]風が吹いた。' : '朝、風が吹いた。',
  )
  expect((await call(env, body)).status).toBe(202)
  expect(await entitlement(env, 'user')).toMatchObject({ reserved: 8, remaining: 492 })
  real.close()
})

it.each([
  ['trial', 'drama-3', 500],
  ['basic', 's2.1-pro', 7500],
  ['standard', 'drama-3', 12000],
  ['plus', 'drama-3', 35000],
  ['premium', 'drama-3', 110000],
])('スタッフ検証の %s はモデルと枠を分け、明示有効化後だけ予約する', async (plan, model, limit) => {
  const { real, env } = setup()
  try {
    env.NARRATION_STAFF_TEST_PLAN = plan
    expect(await entitlement(env, 'user')).toMatchObject({ plan, model, limit, enabled: false })
    expect((await call(env, payload())).status).toBe(503)
    env.NARRATION_PAID_ENABLED = '1'
    vi.mocked(verifyStaff).mockResolvedValueOnce(null)
    expect((await call(env, payload())).status).toBe(404)
    expect((await call(env, payload())).status).toBe(202)
    expect(real.row('SELECT model FROM narration_takes')).toMatchObject({ model })
    expect(await entitlement(env, 'user')).toMatchObject({ reserved: 6 })
    env.NARRATION_RELEASE = '1'
    expect(await entitlement(env, 'user')).toMatchObject({ plan: 'trial', reserved: 0 })
  } finally {
    real.close()
  }
})

it('声を追加しても既存設定の default が使え、Fish の参照IDは返さない', async () => {
  const { real, env } = setup()
  try {
    env.NARRATION_VOICES = JSON.stringify([
      {
        id: 'second',
        label: '追加の声',
        description: '検証用',
        version: '1',
        referenceId: 'b'.repeat(32),
        sampleUrl: '/narration-samples/second.mp3',
      },
    ])
    const { voices } = await entitlement(env, 'user')
    expect(voices).toEqual([
      expect.objectContaining({ id: 'default', label: 'Shiori' }),
      expect.objectContaining({ id: 'second', sampleUrl: '/narration-samples/second.mp3' }),
    ])
    expect(voices.every((voice) => !('referenceId' in voice))).toBe(true)
    expect((await call(env, payload())).status).toBe(202)
  } finally {
    real.close()
  }
})

function payForStandard(env: NarrationEnv, real: ReturnType<typeof makeRealD1>) {
  env.NARRATION_RELEASE = '1'
  env.NARRATION_PAID_ENABLED = '1'
  env.NARRATION_PRICE_STANDARD = 'standard'
  real.insert('subscriptions', {
    user_id: 'user',
    stripe_customer_id: 'c',
    stripe_subscription_id: 's',
    status: 'active',
    price_id: 'standard',
    current_period_end: Date.now() + 86400000,
    grace_until: 0,
    updated_at: Date.now(),
  })
}

it('切り替え後も同じ枠を使い、同時の異なるモデルの予約が二重に通らない', async () => {
  const { real, env } = setup()
  try {
    payForStandard(env, real)
    expect(await entitlement(env, 'user')).toMatchObject({
      modelAllowances: {
        'drama-3': { limit: 12000, remaining: 12000 },
        's2.1-pro': { limit: 24000, remaining: 24000 },
      },
    })
    expect((await call(env, { ...payload(), model: 's2.1-pro' })).status).toBe(202)
    real.exec("UPDATE narration_takes SET state='ready'")
    expect(await entitlement(env, 'user')).toMatchObject({
      modelAllowances: { 'drama-3': { remaining: 11997 }, 's2.1-pro': { remaining: 23994 } },
    })
    real.exec('UPDATE narration_budgets SET used=23993 WHERE unit_quota IS NOT NULL')
    const requests = await Promise.all([
      call(env, { ...payload(), model: 's2.1-pro' }),
      call(env, {
        ...payload(),
        model: 'drama-3',
        segments: resolveSegments(
          { id: 'e', title: '話', blocks: parseEpisodeBody('朝だ。') },
          emptyNarration('w').settings,
        ),
      }),
    ])
    expect(requests.map((response) => response.status).sort()).toEqual([202, 409])
    expect(await entitlement(env, 'user')).toMatchObject({
      modelAllowances: { 'drama-3': { remaining: 0 }, 's2.1-pro': { remaining: 1 } },
    })
    real.exec("UPDATE narration_takes SET state='failed' WHERE state='queued'")
    expect(await entitlement(env, 'user')).toMatchObject({
      modelAllowances: { 'drama-3': { remaining: 3 }, 's2.1-pro': { remaining: 7 } },
    })
  } finally {
    real.close()
  }
})

it('無料体験はS2.1 Proへ切り替えられず、試聴は選択モデルで通常枠を消費しない', async () => {
  const { real, env } = setup()
  try {
    env.NARRATION_RELEASE = '1'
    env.NARRATION_PAID_ENABLED = '1'
    expect((await call(env, { ...payload(), model: 's2.1-pro' })).status).toBe(409)
    payForStandard(env, real)
    env.NARRATION_PREVIEW_LIMIT = '1'
    expect((await call(env, { ...payload(), preview: true, model: 's2.1-pro' })).status).toBe(202)
    expect(real.row('SELECT model FROM narration_takes')).toEqual({ model: 's2.1-pro' })
    expect(await entitlement(env, 'user')).toMatchObject({
      preview: { remaining: 0 },
      modelAllowances: { 'drama-3': { remaining: 12000 }, 's2.1-pro': { remaining: 24000 } },
    })
  } finally {
    real.close()
  }
})

it('旧来の消費と予約を移行し、移行前に開始した処理も確定できる', async () => {
  const { real, env } = setup(false)
  try {
    payForStandard(env, real)
    const period = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)
    const now = Date.now()
    real.exec(`
      INSERT INTO narration_budgets(user_id,period,quota) VALUES ('user','${period}',10000);
      INSERT INTO narration_jobs(id,user_id,work_id,period,request_hash,dispatch_token,created_at)
        VALUES ('old','user','w','${period}','req','token',${now});
      INSERT INTO narration_daily(day,byte_limit) VALUES (${Math.floor(now / 86400000)},1000000);
      INSERT INTO narration_takes(id,job_id,segment_id,fingerprint,characters,input_bytes,model,created_at)
        VALUES ('done','old','a','fp',7,21,'drama-3',${now}),
               ('running','old','b','fp',3,9,'drama-3',${now}),
               ('basic','old','c','fp',5,15,'s2.1-pro',${now});
      UPDATE narration_takes SET state='ready' WHERE id IN ('done','basic');
      UPDATE narration_takes SET state='missing' WHERE id='done';
      UPDATE narration_takes SET state='generating' WHERE id='running';
    `)
    real.exec(sharedQuota)
    expect(await entitlement(env, 'user')).toMatchObject({
      modelAllowances: { 's2.1-pro': { used: 19, reserved: 6, remaining: 23975 } },
    })
    real.exec("UPDATE narration_takes SET state='ready' WHERE id='running'")
    expect(await entitlement(env, 'user')).toMatchObject({
      modelAllowances: { 's2.1-pro': { used: 25, reserved: 0, remaining: 23975 } },
    })
  } finally {
    real.close()
  }
})

it('公開後の未ログインにはサインイン案内を返す', async () => {
  const { real, env } = setup()
  try {
    env.NARRATION_RELEASE = '1'
    vi.mocked(verifyUserId).mockResolvedValueOnce(null)
    const response = await call(env)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: '朗読を作るにはサインインしてください。' })
  } finally {
    real.close()
  }
})
