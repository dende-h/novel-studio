// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { canonicalWorkJson, sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('既知ベクトルと一致する（空文字列）', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('既知ベクトルと一致する（abc）', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('入力が違えばハッシュも違う', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'))
  })

  it('マルチバイト（日本語）も安定して同じ値になる', async () => {
    expect(await sha256Hex('こんにちは')).toBe(await sha256Hex('こんにちは'))
  })
})

describe('canonicalWorkJson', () => {
  const work: Work = {
    id: 'w1',
    title: '作品',
    episodes: [
      {
        id: 'e1',
        title: '第1話',
        blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '本文' }] }],
      },
    ],
    updatedAt: 100,
  }

  it('キーの並び順が違っても同じ文字列になる（スキーマ定義順に正規化）', () => {
    // JSON.parse/stringify を経由してキー挿入順を入れ替えた同内容の Work を作る
    const reordered = {
      updatedAt: 100,
      episodes: work.episodes,
      title: '作品',
      id: 'w1',
    } as Work
    expect(canonicalWorkJson(reordered)).toBe(canonicalWorkJson(work))
  })

  it('未知キーは落ちる（端末間で余計なキーが混じってもハッシュが揺れない）', () => {
    const extra = { ...work, unknownKey: 'x' } as Work
    expect(canonicalWorkJson(extra)).toBe(canonicalWorkJson(work))
  })

  it('同内容なら sha256Hex まで一致する', async () => {
    const clone = structuredClone(work)
    expect(await sha256Hex(canonicalWorkJson(clone))).toBe(await sha256Hex(canonicalWorkJson(work)))
  })

  it('内容が違えば文字列も違う', () => {
    const changed = { ...work, title: '別題' }
    expect(canonicalWorkJson(changed)).not.toBe(canonicalWorkJson(work))
  })

  it('スキーマ違反の Work は throw する（破損データを黙って同期しない）', () => {
    expect(() => canonicalWorkJson({ id: 'w1' } as Work)).toThrow()
  })
})
