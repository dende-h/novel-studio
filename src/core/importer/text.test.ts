import { describe, expect, it } from 'vitest'
import {
  decodeTextFile,
  looksLikeText,
  MAX_WORK_JSON_BYTES,
  normalizeImportedText,
  textBytes,
  workJsonBytes,
} from './text'

const utf8 = (s: string) => new TextEncoder().encode(s)

describe('normalizeImportedText', () => {
  it('BOM を除く', () => {
    expect(normalizeImportedText('﻿第1話\n本文')).toBe('第1話\n本文')
  })
  it('CRLF と CR を LF に揃える', () => {
    expect(normalizeImportedText('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })
  it('BOM が無く LF だけならそのまま', () => {
    expect(normalizeImportedText('a\nb')).toBe('a\nb')
  })
})

describe('looksLikeText', () => {
  it('タブ・改行・全角スペースは本文として許す', () => {
    expect(looksLikeText('　字下げ\tタブ\r\n次の行')).toBe(true)
  })
  it('NUL・置換文字・フォームフィードは本文でない', () => {
    expect(looksLikeText('a\u0000b')).toBe(false)
    expect(looksLikeText('a�b')).toBe(false)
    expect(looksLikeText('a\u000Cb')).toBe(false)
  })
})

describe('decodeTextFile', () => {
  it('UTF-8（BOM・CRLF 付き）を復号し normalize する', () => {
    const r = decodeTextFile(utf8('﻿第1話\r\n　本文'))
    expect(r).toEqual({ text: '第1話\n　本文', encoding: 'utf-8' })
  })
  it('Shift_JIS のバイト列を復号する（「あい」＝ 82 A0 82 A2）', () => {
    const r = decodeTextFile(new Uint8Array([0x82, 0xa0, 0x82, 0xa2, 0x0d, 0x0a, 0x82, 0xa4]))
    expect(r).toEqual({ text: 'あい\nう', encoding: 'shift_jis' })
  })
  it('PNG ヘッダ（画像のリネーム）は null', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ])
    expect(decodeTextFile(png)).toBeNull()
  })
  it('NUL を含む UTF-8 は null', () => {
    expect(decodeTextFile(utf8('本文\u0000本文'))).toBeNull()
  })
  it('空ファイルは空文字の UTF-8', () => {
    expect(decodeTextFile(new Uint8Array([]))).toEqual({ text: '', encoding: 'utf-8' })
  })
})

describe('サイズ', () => {
  it('textBytes は UTF-8 のバイト数', () => {
    expect(textBytes('あ')).toBe(3)
    expect(textBytes('a')).toBe(1)
  })
  it('workJsonBytes は JSON.stringify の UTF-8 バイト数と一致し、上限は 20MB', () => {
    const work = { id: 'w', title: 'あ', episodes: [] }
    expect(workJsonBytes(work)).toBe(utf8(JSON.stringify(work)).byteLength)
    expect(MAX_WORK_JSON_BYTES).toBe(20 * 1024 * 1024)
  })
})
