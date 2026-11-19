import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyNarration } from '../src/core/narration/types'

test('朗読をZIPで書き出し、新しいブラウザへオフラインで復元する', async ({ page, browser }) => {
  await page.goto('/')
  const record = emptyNarration('backup-voice')
  record.settings.dictionary = [{ id: 'r', surface: '小夏', reading: 'こなつ' }]
  record.takes = ['accepted', 'candidate'].map(id => ({ id, segmentId: 's', fingerprint: id, jobId: 'j', state: 'ready' as const, createdAt: 1 }))
  record.accepted = { s: 'accepted' }
  record.candidates = { s: 'candidate' }
  const audio = Array.from(readFileSync('e2e/fixtures/narration-tone.mp3'))
  await page.evaluate(async ({ record, audio }) => {
    localStorage.setItem('ns-onboarded', '1')
    const req = indexedDB.open('novel-studio', 1)
    const db = await new Promise<IDBDatabase>(resolve => { req.onsuccess = () => resolve(req.result) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      const kv = tx.objectStore('kv')
      kv.put({ id: 'backup-voice', title: '朗読バックアップ確認', episodes: [] }, 'work:backup-voice')
      kv.put(record, 'narration:local:backup-voice')
      for (const id of ['accepted', 'candidate']) kv.put(new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'narration-audio:local:' + id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, { record, audio })
  await page.reload()
  await page.getByRole('button', { name: 'データ管理' }).click()
  await page.getByText('バックアップを書き出し', { exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: '書き出す' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
  const path = await download.path()
  expect(path).toBeTruthy()
  const context = await browser.newContext()
  const other = await context.newPage()
  await other.goto('/')
  await other.evaluate(() => localStorage.setItem('ns-onboarded', '1'))
  await other.reload()
  await other.getByRole('button', { name: 'データ管理' }).click()
  await other.getByText('バックアップを取り込み', { exact: true }).click()
  await context.setOffline(true)
  await other.locator('input[type=file][accept*=".zip"]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: readFileSync(path!) })
  await expect(other.getByRole('dialog')).toContainText('朗読：1作品')
  await other.getByRole('button', { name: 'すべて置き換えて復元' }).click()
  await expect(other.getByRole('dialog')).toContainText('全体を復元しました')
  const restored = await other.evaluate(async () => {
    const req = indexedDB.open('novel-studio', 1)
    const db = await new Promise<IDBDatabase>(resolve => { req.onsuccess = () => resolve(req.result) })
    const get = (key: string) => new Promise<any>(resolve => {
      const r = db.transaction('kv').objectStore('kv').get(key)
      r.onsuccess = () => resolve(r.result)
    })
    const record = await get('narration:local:backup-voice')
    const a = await get('narration-audio:local:accepted') as Blob
    const b = await get('narration-audio:local:candidate') as Blob
    db.close()
    return { record, audio: Array.from(new Uint8Array(await a.arrayBuffer())), candidate: b.size }
  })
  expect(restored.record.accepted).toEqual(record.accepted)
  expect(restored.record.candidates).toEqual(record.candidates)
  expect(restored.record.settings.dictionary).toEqual(record.settings.dictionary)
  expect(restored.audio).toEqual(audio)
  expect(restored.candidate).toBe(audio.length)
  await other.screenshot({ path: 'test-results/narration-backup-restored.png', fullPage: true })
  await context.close()
})
