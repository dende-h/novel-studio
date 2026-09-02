// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import { TEMPLATE_MANIFEST_KEY, templateObjectKey } from '../api/_lib/templates-store'
import { makeFakeR2 } from '../api/sync/sync-test-util'
import { onRequest, parseTemplateObjectPath } from './[[path]]'

function call(env: unknown, url: string, method = 'GET'): Promise<Response> {
  return onRequest({ request: new Request(url, { method }), env } as never) as Promise<Response>
}

describe('parseTemplateObjectPath', () => {
  it('bg/sprite と slug、サムネの有無を読む', () => {
    expect(parseTemplateObjectPath('bg/room-day.webp')).toEqual({
      kind: 'bg',
      slug: 'room-day',
      thumb: false,
    })
    expect(parseTemplateObjectPath('sprite/silhouette-woman.thumb.webp')).toEqual({
      kind: 'sprite',
      slug: 'silhouette-woman',
      thumb: true,
    })
  })

  it('種別違い・slug の形違い・拡張子違いは null', () => {
    expect(parseTemplateObjectPath('se/rain.webp')).toBeNull()
    expect(parseTemplateObjectPath('bg/Room-Day.webp')).toBeNull()
    expect(parseTemplateObjectPath('bg/room-day.png')).toBeNull()
    expect(parseTemplateObjectPath('bg/../manifest.json')).toBeNull()
  })
})

describe('GET /game-templates/*', () => {
  it('目録が無ければ空の目録を返す（配信を止めない）', async () => {
    const { bucket } = makeFakeR2()
    const res = await call({ MEDIA: bucket }, 'https://x/game-templates/manifest.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('max-age=300')
    expect(await res.json()).toMatchObject({ v: 1, entries: [] })
  })

  it('目録があればそのまま返す', async () => {
    const { bucket, objects } = makeFakeR2()
    objects.set(
      TEMPLATE_MANIFEST_KEY,
      new TextEncoder().encode(JSON.stringify({ v: 1, updatedAt: 5, entries: [] })),
    )
    const res = await call({ MEDIA: bucket }, 'https://x/game-templates/manifest.json')
    expect(await res.json()).toMatchObject({ updatedAt: 5 })
  })

  it('実体は immutable で返し、無ければ 404', async () => {
    const { bucket, objects } = makeFakeR2()
    objects.set(templateObjectKey('bg', 'room-day'), new Uint8Array([1, 2, 3]))
    const hit = await call({ MEDIA: bucket }, 'https://x/game-templates/bg/room-day.webp?v=abc')
    expect(hit.status).toBe(200)
    expect(hit.headers.get('cache-control')).toContain('immutable')
    expect(hit.headers.get('content-type')).toBe('image/webp')
    expect(new Uint8Array(await hit.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    const miss = await call({ MEDIA: bucket }, 'https://x/game-templates/bg/room-night.webp')
    expect(miss.status).toBe(404)
    expect(miss.headers.get('cache-control')).toBe('no-store')
  })

  it('形の違うパスと GET 以外は通さない', async () => {
    const { bucket } = makeFakeR2()
    expect((await call({ MEDIA: bucket }, 'https://x/game-templates/bg/../x.webp')).status).toBe(
      404,
    )
    expect(
      (await call({ MEDIA: bucket }, 'https://x/game-templates/manifest.json', 'PUT')).status,
    ).toBe(405)
  })
})
