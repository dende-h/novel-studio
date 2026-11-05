import { expect, it } from 'vitest'
import { sha256Hex } from '../sync/hash'
import { fingerprint } from './fingerprint'

it('UTF-8・複数ブロック・パディング境界でWeb Crypto SHA-256と一致する', async () => {
  for (const value of [
    '',
    'abc',
    'あ😀',
    'x'.repeat(55),
    'x'.repeat(56),
    'a'.repeat(64),
    '日本語'.repeat(1000),
  ]) {
    expect(fingerprint(value)).toBe(await sha256Hex(value))
  }
})
