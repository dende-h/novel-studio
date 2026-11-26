import { MAX_IMPORT_BYTES, textBytes } from '@/core/importer/text'
import type { SourceNotation } from '@/core/sites/portability'
import { IdbStore } from '@/core/storage/idbStore'

const key = 'notation-converter-draft'
const store = new IdbStore('leaf-notation-converter')
type Handoff = { text: string; notation: SourceNotation; expiresAt: number }

export async function handoffNotation(text: string, notation: SourceNotation) {
  if (textBytes(text) > MAX_IMPORT_BYTES) throw new Error('原稿は20 MBまで取り込めます')
  const token = crypto.randomUUID()
  const previous = sessionStorage.getItem(key)
  await store.set(token, { text, notation, expiresAt: Date.now() + 60 * 60 * 1000 })
  try {
    sessionStorage.setItem(key, token)
  } catch (error) {
    await store.delete(token)
    throw error
  }
  if (previous) await store.delete(previous).catch(() => {})
}

let taking: Promise<Handoff | undefined> | undefined
export function takeNotationHandoff() {
  if (taking) return taking
  taking = (async () => {
    const token = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)
    if (!token) return
    const draft = await store.get<Handoff>(token)
    await store.delete(token)
    sessionStorage.removeItem(key)
    return draft && draft.expiresAt > Date.now() ? draft : undefined
  })().finally(() => {
    taking = undefined
  })
  return taking
}
