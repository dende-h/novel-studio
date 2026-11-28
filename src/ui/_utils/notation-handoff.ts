import { MAX_IMPORT_BYTES, textBytes } from '@/core/importer/text'
import type { SourceNotation } from '@/core/sites/portability'
import { IdbStore } from '@/core/storage/idbStore'

const key = 'notation-converter-draft'
const store = new IdbStore('leaf-notation-converter')
type Handoff = { text: string; notation: SourceNotation; expiresAt: number }

async function pruneExpiredDrafts(now: number) {
  for (const token of await store.keys()) {
    const draft = await store.get<Handoff>(token)
    if (draft && draft.expiresAt <= now) await store.delete(token)
  }
}

export async function handoffNotation(text: string, notation: SourceNotation) {
  if (textBytes(text) > MAX_IMPORT_BYTES) throw new Error('原稿は20 MBまで取り込めます')
  const token = crypto.randomUUID()
  const now = Date.now()
  await pruneExpiredDrafts(now)
  await store.set(token, { text, notation, expiresAt: now + 60 * 60 * 1000 })
  try {
    sessionStorage.setItem(key, token)
  } catch (error) {
    await store.delete(token)
    throw error
  }
}

let taking: Promise<Handoff | undefined> | undefined
export function takeNotationHandoff() {
  if (taking) return taking
  taking = (async () => {
    if (typeof sessionStorage === 'undefined' || typeof indexedDB === 'undefined') return
    const token = sessionStorage.getItem(key)
    await pruneExpiredDrafts(Date.now()).catch((error: unknown) => {
      if (token) throw error
    })
    if (!token || sessionStorage.getItem(key) !== token) return
    const draft = await store.get<Handoff>(token)
    if (sessionStorage.getItem(key) !== token) return
    // A duplicated tab can still hold the same token. Its copy expires independently.
    sessionStorage.removeItem(key)
    return draft && draft.expiresAt > Date.now() ? draft : undefined
  })().finally(() => {
    taking = undefined
  })
  return taking
}
