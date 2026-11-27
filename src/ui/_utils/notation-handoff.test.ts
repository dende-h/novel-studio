import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { IdbStore } from '@/core/storage/idbStore'
import { handoffNotation, takeNotationHandoff } from './notation-handoff'

const store = new IdbStore('leaf-notation-converter')
const key = 'notation-converter-draft'
const draft = (text: string, expiresAt: number) => ({ text, notation: 'auto', expiresAt })

beforeEach(async () => {
  sessionStorage.clear()
  for (const token of await store.keys()) await store.delete(token)
})

it('作成・読取時は期限切れだけを削除し、別タブや複製タブの有効な原稿を保つ', async () => {
  await store.set('expired-at-write', draft('期限切れ', Date.now() - 1))
  await handoffNotation('別タブの原稿', 'auto')
  const first = sessionStorage.getItem(key) ?? ''
  await handoffNotation('今のタブの原稿', 'estar')
  const second = sessionStorage.getItem(key) ?? ''
  await store.set('expired-at-read', draft('期限切れ', Date.now() - 1))
  expect(await store.get('expired-at-write')).toBeUndefined()
  expect(await store.get(first)).toMatchObject({ text: '別タブの原稿' })
  expect(await takeNotationHandoff()).toMatchObject({ text: '今のタブの原稿', notation: 'estar' })
  expect(await store.get('expired-at-read')).toBeUndefined()
  expect(sessionStorage.getItem(key)).toBeNull()
  sessionStorage.setItem(key, first)
  expect(await takeNotationHandoff()).toMatchObject({ text: '別タブの原稿' })
  sessionStorage.setItem(key, second)
  expect(await takeNotationHandoff()).toMatchObject({ text: '今のタブの原稿' })
  expect((await store.keys()).sort()).toEqual([first, second].sort())
})

it('引き継ぎなしでホームを開いたときも期限切れを掃除する', async () => {
  await store.set('expired', draft('期限切れ', Date.now() - 1))
  await store.set('valid', draft('別タブ', Date.now() + 60_000))
  expect(await takeNotationHandoff()).toBeUndefined()
  expect(await store.keys()).toEqual(['valid'])
})
