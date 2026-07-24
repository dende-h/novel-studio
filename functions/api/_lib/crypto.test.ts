// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decryptPart, encryptPart, gunzip, gzip, importKey, sha256Hex } from './crypto'

// 32byte（全部 7）の base64 鍵。
const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

describe('gzip / gunzip', () => {
  it('往復で元の文字列に戻る', async () => {
    const text = JSON.stringify({ a: 1, 本文: 'あいうえお'.repeat(100) })
    expect(await gunzip(await gzip(text))).toBe(text)
  })
})

describe('encryptPart / decryptPart（gzip→AES-GCM）', () => {
  it('同じ AAD なら往復で平文に戻る', async () => {
    const key = await importKey(KEY_B64)
    const plaintext = JSON.stringify({ id: 'w1', title: '物語' })
    const blob = await encryptPart(plaintext, key, 'user_1:w1:doc')
    expect(await decryptPart(blob, key, 'user_1:w1:doc')).toBe(plaintext)
  })

  it('先頭 12byte は IV（毎回変わる）で、暗号文は平文と異なる', async () => {
    const key = await importKey(KEY_B64)
    const a = await encryptPart('x', key, 'aad')
    const b = await encryptPart('x', key, 'aad')
    expect(a.subarray(0, 12)).not.toEqual(b.subarray(0, 12))
  })

  it('AAD が違うと復号は失敗する（part の取り違え防止）', async () => {
    const key = await importKey(KEY_B64)
    const blob = await encryptPart('secret', key, 'user_1:w1:doc')
    await expect(decryptPart(blob, key, 'user_1:w1:media')).rejects.toBeDefined()
  })
})

describe('importKey', () => {
  it('32byte でない鍵は拒否する', async () => {
    await expect(importKey(btoa('short'))).rejects.toThrow()
  })
})

describe('sha256Hex', () => {
  it('空文字の既知ハッシュと一致する', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('同じ入力で安定し、違う入力で変わる', async () => {
    expect(await sha256Hex('abc')).toBe(await sha256Hex('abc'))
    expect(await sha256Hex('abc')).not.toBe(await sha256Hex('abd'))
  })
})
