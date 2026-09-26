import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../schema'
import { applyGlossaryFieldPatch } from './patch'

const base = (): GlossaryEntry => ({
  id: 'g',
  name: 'アリス',
  aliases: [],
  summary: '概要',
  body: '旧',
  thumbnail: 'data:image/png;base64,x',
  dialog: { title: { text: '灯台守', public: true }, flaw: { text: '忘れっぽい' } },
  dialogVersion: 1,
  createdAt: 0,
  updatedAt: 0,
})

describe('applyGlossaryFieldPatch', () => {
  it('渡した欄だけ書き換え、updatedAt を進める', () => {
    const next = applyGlossaryFieldPatch(base(), { reading: 'ありす' }, 10)
    expect(next).toMatchObject({ reading: 'ありす', summary: '概要', body: '旧', updatedAt: 10 })
    expect(next.dialog).toEqual(base().dialog)
  })

  it('summary を渡したら旧・詳細（body）を畳み、空なら summary も持たない', () => {
    expect(applyGlossaryFieldPatch(base(), { summary: '新' }, 1)).toMatchObject({ summary: '新' })
    expect(applyGlossaryFieldPatch(base(), { summary: '新' }, 1).body).toBeUndefined()
    const cleared = applyGlossaryFieldPatch(base(), { summary: undefined }, 1)
    expect(cleared.summary).toBeUndefined()
    expect(cleared.body).toBeUndefined()
  })

  it('thumbnail の空文字は削除、undefined は据え置き', () => {
    expect(applyGlossaryFieldPatch(base(), { thumbnail: '' }, 1).thumbnail).toBeUndefined()
    expect(applyGlossaryFieldPatch(base(), { reading: 'a' }, 1).thumbnail).toBe(base().thumbnail)
  })

  it('dialogVersion だけのパッチは何も書かない（版は対話ノートと一緒にだけ動く）', () => {
    const plain: GlossaryEntry = { id: 'p', name: 'x', aliases: [], createdAt: 0, updatedAt: 0 }
    const next = applyGlossaryFieldPatch(plain, { dialogVersion: 1 }, 1)
    expect(next.dialogVersion).toBeUndefined()
    expect(next.dialog).toBeUndefined()
    // 対話ノートがある項目なら版だけ上げられる
    expect(applyGlossaryFieldPatch(base(), { dialogVersion: 2 }, 1).dialogVersion).toBe(2)
  })

  it('dialogPatch は鍵ごとに重ね、null で消し、空になれば record ごと落とす', () => {
    const merged = applyGlossaryFieldPatch(
      base(),
      { dialogPatch: { flaw: null, secret: { text: '正体' } } },
      1,
    )
    expect(merged.dialog).toEqual({
      title: { text: '灯台守', public: true },
      secret: { text: '正体' },
    })
    expect(merged.dialogVersion).toBe(1)
    const emptied = applyGlossaryFieldPatch(
      merged,
      { dialogPatch: { title: null, secret: null } },
      2,
    )
    expect(emptied.dialog).toBeUndefined()
    expect(emptied.dialogVersion).toBeUndefined()
  })
})
