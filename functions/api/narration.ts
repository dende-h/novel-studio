/// <reference types="@cloudflare/workers-types" />
import { type ClerkEnv, json } from './_lib/auth'
import { verifyStaff } from './_lib/staff'

interface Env extends ClerkEnv {
  DB: D1Database
  FISH_AUDIO_API_KEY?: string
  FISH_NARRATION_VOICE_ID?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (
    !env.FISH_AUDIO_API_KEY ||
    !env.FISH_NARRATION_VOICE_ID ||
    !(await verifyStaff(request, env))
  ) {
    return json({ error: 'not_found' }, 404)
  }
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'invalid_text' }, 400)
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > 16_000) {
      await reader.cancel()
      return json({ error: 'too_long' }, 413)
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  if (!text.trim()) return json({ error: 'invalid_text' }, 400)

  try {
    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.FISH_AUDIO_API_KEY}`,
        'content-type': 'application/json',
        model: 's2.1-pro-free',
      },
      body: JSON.stringify({
        text,
        reference_id: env.FISH_NARRATION_VOICE_ID,
        format: 'mp3',
        latency: 'normal',
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('content-type')?.startsWith('audio/')
    ) {
      return json({ error: 'generation_failed' }, response.status === 429 ? 429 : 502)
    }
    return new Response(response.body, {
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
    })
  } catch {
    return json({ error: 'generation_failed' }, 502)
  }
}
