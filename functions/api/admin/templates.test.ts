// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 認証は可変の userId を返すようにモック（null なら未認証）。
// staff かどうかは D1 フェイクの board_profiles.role で決まる。
const authState = vi.hoisted(() => ({ userId: 'user_staff' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('../board/board-test-util')
  return clerkAuthMock(authState)
})

import type { TemplateManifest } from '../../../src/core/game/templates'
import { TEMPLATE_MANIFEST_KEY, templateObjectKey } from '../_lib/templates-store'
import { fakeProfile, makeBoardEnv } from '../board/board-test-util'
import { makeFakeR2 } from '../sync/sync-test-util'
import {
  onRequestDelete,
  onRequestGet,
  onRequestPatch,
  onRequestPut,
  TEMPLATE_MAX_DATA_URL,
} from './templates'

function makeEnv() {
  const { bucket, objects } = makeFakeR2()
  const env = {
    ...makeBoardEnv({
      profiles: [
        fakeProfile({ user_id: 'user_staff', role: 'staff', name_key: 'staff' }),
        fakeProfile({ user_id: 'user_member', role: 'member', name_key: 'member' }),
      ],
    }),
    MEDIA: bucket,
  }
  return { env, objects }
}

type Handler = PagesFunction<never>
const call = (handler: Handler, env: unknown, request: Request): Promise<Response> =>
  handler({ request, env } as never) as Promise<Response>

const BASE = 'https://x/api/admin/templates'
const auth = { authorization: 'Bearer x', 'content-type': 'application/json' }
const WEBP = 'data:image/webp;base64,UklGRg=='
const TONE: [string, string, string] = ['#111111', '#222222', '#333333']

const put = (kind: string, slug: string, body: unknown) =>
  new Request(`${BASE}?kind=${kind}&slug=${slug}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify(body),
  })

async function manifestOf(objects: Map<string, Uint8Array>): Promise<TemplateManifest> {
  const raw = objects.get(TEMPLATE_MANIFEST_KEY)
  if (!raw) throw new Error('目録が無い')
  return JSON.parse(new TextDecoder().decode(raw)) as TemplateManifest
}

beforeEach(() => {
  authState.userId = 'user_staff'
})

describe('staff 以外は 404（管理の口を教えない）', () => {
  it('未認証・member はどのメソッドも 404', async () => {
    const { env } = makeEnv()
    for (const userId of [null, 'user_member', 'user_unknown']) {
      authState.userId = userId
      const get = await call(onRequestGet, env, new Request(BASE, { headers: auth }))
      expect(get.status).toBe(404)
      const res = await call(
        onRequestPut,
        env,
        put('bg', 'room-day', { dataUrl: WEBP, tone: TONE }),
      )
      expect(res.status).toBe(404)
    }
  })
})

describe('GET / PUT / PATCH / DELETE（staff）', () => {
  it('目録が無ければ空の目録を no-store で返す', async () => {
    const { env } = makeEnv()
    const res = await call(onRequestGet, env, new Request(BASE, { headers: auth }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.json()).toMatchObject({ v: 1, entries: [] })
  })

  it('PUT は実体を R2 に置き、目録の項目を作る（分類・時間帯はファイル名から）', async () => {
    const { env, objects } = makeEnv()
    const res = await call(
      onRequestPut,
      env,
      put('bg', 'town-alley-night', {
        dataUrl: WEBP,
        thumbDataUrl: WEBP,
        tone: TONE,
        label: '路地（夜）',
      }),
    )
    expect(res.status).toBe(200)
    const { entry } = (await res.json()) as { entry: Record<string, unknown> }
    expect(entry).toMatchObject({
      kind: 'bg',
      slug: 'town-alley-night',
      label: '路地（夜）',
      category: 'town',
      time: 'night',
      mime: 'image/webp',
      bytes: 4,
    })
    expect(typeof entry.hash).toBe('string')
    expect(entry.thumbHash).toBe(entry.hash)
    expect(objects.has(templateObjectKey('bg', 'town-alley-night'))).toBe(true)
    expect(objects.has(templateObjectKey('bg', 'town-alley-night', 'thumb'))).toBe(true)
    const m = await manifestOf(objects)
    expect(m.entries).toHaveLength(1)
  })

  it('同じ slug へもう一度 PUT すると置き換え。省略した表示名・分類は据え置き', async () => {
    const { env, objects } = makeEnv()
    await call(
      onRequestPut,
      env,
      put('bg', 'room-day', { dataUrl: WEBP, tone: TONE, label: '部屋' }),
    )
    const res = await call(
      onRequestPut,
      env,
      put('bg', 'room-day', {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        tone: ['#000000', '#000000', '#000000'],
      }),
    )
    expect(res.status).toBe(200)
    const m = await manifestOf(objects)
    expect(m.entries).toHaveLength(1)
    expect(m.entries[0]).toMatchObject({ label: '部屋', category: 'room', mime: 'image/png' })
    expect(m.entries[0]?.thumbHash).toBeUndefined()
  })

  it('立ち絵は時間帯を持たない', async () => {
    const { env, objects } = makeEnv()
    await call(
      onRequestPut,
      env,
      put('sprite', 'silhouette-knight', { dataUrl: WEBP, tone: TONE, time: 'day' }),
    )
    const m = await manifestOf(objects)
    expect(m.entries[0]).toMatchObject({ kind: 'sprite', category: 'knight' })
    expect(m.entries[0]?.time).toBeUndefined()
  })

  it('形の違う slug・画像でない data URL・大きすぎる実体は弾く', async () => {
    const { env } = makeEnv()
    expect(
      (await call(onRequestPut, env, put('bg', 'Room_Day', { dataUrl: WEBP, tone: TONE }))).status,
    ).toBe(400)
    expect(
      (await call(onRequestPut, env, put('se', 'rain', { dataUrl: WEBP, tone: TONE }))).status,
    ).toBe(400)
    expect(
      (
        await call(
          onRequestPut,
          env,
          put('bg', 'room-day', { dataUrl: 'data:text/plain;base64,SGk=', tone: TONE }),
        )
      ).status,
    ).toBe(400)
    const huge = `data:image/webp;base64,${'A'.repeat(TEMPLATE_MAX_DATA_URL)}`
    expect(
      (await call(onRequestPut, env, put('bg', 'room-day', { dataUrl: huge, tone: TONE }))).status,
    ).toBe(413)
  })

  it('PATCH は渡した項目だけ書き換え、分類の表示名も持てる', async () => {
    const { env, objects } = makeEnv()
    await call(
      onRequestPut,
      env,
      put('bg', 'room-day', { dataUrl: WEBP, tone: TONE, label: '部屋' }),
    )
    const res = await call(
      onRequestPatch,
      env,
      new Request(BASE, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({
          entries: [{ kind: 'bg', slug: 'room-day', hidden: true, time: null }],
          categories: { bg: { room: '室内' } },
        }),
      }),
    )
    expect(res.status).toBe(200)
    const m = await manifestOf(objects)
    expect(m.entries[0]).toMatchObject({ label: '部屋', hidden: true })
    expect(m.entries[0]?.time).toBeUndefined()
    expect(m.categories.bg).toEqual({ room: '室内' })
  })

  it('DELETE は非表示にするだけ（実体も項目も残る）。無い項目は 404', async () => {
    const { env, objects } = makeEnv()
    await call(onRequestPut, env, put('bg', 'room-day', { dataUrl: WEBP, tone: TONE }))
    const res = await call(
      onRequestDelete,
      env,
      new Request(`${BASE}?kind=bg&slug=room-day`, { method: 'DELETE', headers: auth }),
    )
    expect(res.status).toBe(200)
    const m = await manifestOf(objects)
    expect(m.entries[0]?.hidden).toBe(true)
    expect(objects.has(templateObjectKey('bg', 'room-day'))).toBe(true)
    const miss = await call(
      onRequestDelete,
      env,
      new Request(`${BASE}?kind=bg&slug=nothing`, { method: 'DELETE', headers: auth }),
    )
    expect(miss.status).toBe(404)
  })
})
