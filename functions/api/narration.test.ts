/// <reference types="@cloudflare/workers-types" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from './narration'

const { verifyStaff } = vi.hoisted(() => ({ verifyStaff: vi.fn() }))
vi.mock('./_lib/staff', () => ({ verifyStaff }))

function generate(text: string) {
  return onRequestPost({
    request: new Request('https://leaf.example/api/narration', { method: 'POST', body: text }),
    env: { FISH_AUDIO_API_KEY: 'test', FISH_NARRATION_VOICE_ID: 'voice' },
  } as Parameters<typeof onRequestPost>[0])
}

afterEach(() => {
  vi.unstubAllGlobals()
  verifyStaff.mockReset()
})

describe('朗読試作API', () => {
  it('運営以外の原稿を外部へ送らない', async () => {
    verifyStaff.mockResolvedValue(null)
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    expect((await generate('本文')).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('無料モデルを明示して演技指示つきの原稿を送る', async () => {
    verifyStaff.mockResolvedValue('staff')
    const upstream = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([255, 251]), { headers: { 'content-type': 'audio/mpeg' } }),
      )
    vi.stubGlobal('fetch', upstream)
    const text = '[そっとささやくように] おやすみ。'
    const response = await generate(text)
    expect(upstream).toHaveBeenCalledWith(
      'https://api.fish.audio/v1/tts',
      expect.objectContaining({
        headers: expect.objectContaining({ model: 's2.1-pro-free' }),
        body: expect.stringContaining(text),
      }),
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 251]))
  })
})
