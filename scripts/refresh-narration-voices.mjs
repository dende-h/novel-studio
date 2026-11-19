import { writeFile } from 'node:fs/promises'

const samplePattern =
  /^https:\/\/platform\.r2\.fish\.audio\/(?:task|tasks\/\d{4}-\d{2}-\d{2})\/[a-f0-9]{32}\.mp3$/
const voices = new Map()
const pageSize = 100
for (let page = 1; ; page++) {
  const url = new URL('https://api.fish.audio/model')
  url.search = new URLSearchParams({
    language: 'ja',
    licensed: 'true',
    page_size: String(pageSize),
    page_number: String(page),
  })
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Fish Audio voice catalog returned ' + response.status)
  const result = await response.json()
  if (!Array.isArray(result.items) || result.window_limited)
    throw new Error('Fish Audio did not return a complete catalog')

  for (const voice of result.items) {
    if (
      !voice.licensed ||
      voice.visibility !== 'public' ||
      voice.state !== 'trained' ||
      voice.dmca_taken_down ||
      (voice.pvc_retire_effective_at && Date.parse(voice.pvc_retire_effective_at) <= Date.now()) ||
      !voice.languages?.includes('ja') ||
      !/^[a-f0-9]{32}$/.test(voice._id) ||
      typeof voice.title !== 'string' ||
      !voice.title.trim()
    )
      continue

    const sampleUrl = voice.samples?.find((sample) => samplePattern.test(sample.audio))?.audio
    voices.set(voice._id, {
      id: 'fish-' + voice._id,
      label: voice.title.trim(),
      description: '',
      version: voice.updated_at ?? '1',
      referenceId: voice._id,
      sampleUrl,
      availableUntil: voice.pvc_retire_effective_at ?? undefined,
    })
  }

  if (result.has_more === false || (result.has_more == null && result.items.length < pageSize)) break
  if (!result.items.length || page >= 100) throw new Error('Fish Audio pagination did not finish')
}

if (!voices.size) throw new Error('No eligible Japanese voices returned')
await writeFile(
  new URL('../functions/api/_lib/narration-voices.json', import.meta.url),
  JSON.stringify([...voices.values()], null, 2) + '\n',
)
console.log('Japanese licensed voices: ' + voices.size)
