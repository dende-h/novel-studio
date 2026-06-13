import { describe, expect, it } from 'vitest'
import { crc32, zipStore } from '.'

const text = (u: Uint8Array) => new TextDecoder().decode(u)

describe('crc32', () => {
  it('空文字は 0', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })
  it('既知ベクタ "The quick brown fox jumps over the lazy dog"', () => {
    const data = new TextEncoder().encode('The quick brown fox jumps over the lazy dog')
    expect(crc32(data) >>> 0).toBe(0x414fa339)
  })
})

describe('zipStore（store方式・無圧縮）', () => {
  it('PK ローカルヘッダで始まり EOCD で終わる', () => {
    const z = zipStore([{ path: 'a.txt', data: 'hello' }])
    expect(z[0]).toBe(0x50) // 'P'
    expect(z[1]).toBe(0x4b) // 'K'
    expect(z[2]).toBe(0x03)
    expect(z[3]).toBe(0x04)
    // EOCD signature PK\x05\x06 が末尾付近に存在
    const eocd = z.length - 22
    expect(z[eocd]).toBe(0x50)
    expect(z[eocd + 1]).toBe(0x4b)
    expect(z[eocd + 2]).toBe(0x05)
    expect(z[eocd + 3]).toBe(0x06)
  })

  it('EOCD のエントリ数がファイル数と一致', () => {
    const z = zipStore([
      { path: 'a.txt', data: 'a' },
      { path: 'b.txt', data: 'b' },
      { path: 'c.txt', data: 'c' },
    ])
    const eocd = z.length - 22
    const view = new DataView(z.buffer, z.byteOffset, z.byteLength)
    expect(view.getUint16(eocd + 10, true)).toBe(3) // total entries
  })

  it('格納データがそのまま含まれる（無圧縮）', () => {
    const z = zipStore([{ path: 'a.txt', data: 'HELLO_ZIP' }])
    expect(text(z)).toContain('HELLO_ZIP')
    expect(text(z)).toContain('a.txt')
  })

  it('文字列と Uint8Array の両方を受け取れる', () => {
    const z = zipStore([{ path: 'bin', data: new Uint8Array([1, 2, 3]) }])
    expect(z.length).toBeGreaterThan(0)
  })
})
