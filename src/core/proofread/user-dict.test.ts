import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../schema'
import { glossaryTerms, glossaryUserDictCsv } from './user-dict'

const entry = (name: string, aliases: string[] = [], reading?: string): GlossaryEntry =>
  ({ id: name, name, aliases, reading }) as GlossaryEntry

describe('用語集のユーザー辞書', () => {
  it('名前は読み（ひらがな→カタカナ）、別名は表層形をカタカナにして 1 行ずつ', () => {
    expect(
      glossaryUserDictCsv([entry('黒鉄城', ['くろがね'], 'くろがねじょう'), entry('ユイナ')]),
    ).toBe(
      '黒鉄城,カスタム名詞,クロガネジョウ\nくろがね,カスタム名詞,クロガネ\nユイナ,カスタム名詞,ユイナ\n',
    )
  })
  it('空・重複・改行を落とし、カンマと引用符をエスケープする', () => {
    expect(glossaryUserDictCsv([entry(' a,b '), entry('a,b'), entry(''), entry('x"y\n')])).toBe(
      '"a,b",カスタム名詞,"a,b"\n"x""y",カスタム名詞,"x""y"\n',
    )
    expect(glossaryUserDictCsv([])).toBe('')
  })
  it('指摘の対象から外す語の一覧', () => {
    expect(glossaryTerms([entry('宮森', ['ミヤ', ' ']), entry('宮森')])).toEqual(['宮森', 'ミヤ'])
  })
})
