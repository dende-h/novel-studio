// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createAnalyzerEngine, type LinderaLike, textsHash } from './analyzer-engine'
import { unzipEntries } from './unzip'

/**
 * 解析の本体を、実物の lindera-wasm と辞書 zip で動かす（COT-40）。
 * 辞書は scripts/fetch-dict.mjs（pretest）が public/dict/ に置く。CI では必ずあるので、無ければ失敗させる。
 */
const zipPath = resolve(process.cwd(), 'public/dict/lindera-ipadic-6.2.0.zip')
const hasDict = existsSync(zipPath)
const run = hasDict || process.env.CI ? describe : describe.skip

async function loadLindera(): Promise<LinderaLike> {
  const require = createRequire(resolve(process.cwd(), 'package.json'))
  const dir = dirname(require.resolve('lindera-wasm'))
  const mod = await import(pathToFileURL(join(dir, 'lindera_wasm.js')).href)
  mod.initSync({ module: readFileSync(join(dir, 'lindera_wasm_bg.wasm')) })
  return mod as unknown as LinderaLike
}

run('解析の本体（実物の lindera と辞書）', () => {
  it('zip を展開して 9 ファイルを取り出す', async () => {
    const files = await unzipEntries(new Uint8Array(readFileSync(zipPath)))
    for (const name of ['metadata.json', 'dict.trie', 'dict.valsidx', 'dict.words', 'unk.bin']) {
      expect(files.get(name)?.length ?? 0, name).toBeGreaterThan(0)
    }
  })

  it('ユーザー辞書の語を 1 語にし、作品全体の集計といまの話のトークンを返す', async () => {
    const engine = createAnalyzerEngine(
      await loadLindera(),
      async () => new Uint8Array(readFileSync(zipPath)),
    )
    await engine.init('黒鉄城,カスタム名詞,クロガネジョウ\n', ['黒鉄城'])
    const e1 = ['　黒鉄城で子供が遊ぶ。', '　ふと、空を見た。']
    const e2 = ['　子どもが笑った。ふと気づいた。']
    const progress: number[] = []
    const r = engine.analyze(
      [
        { id: 'e1', hash: textsHash(e1), texts: e1 },
        { id: 'e2', hash: textsHash(e2), texts: e2 },
      ],
      'e1',
      (done) => progress.push(done),
    )
    expect(progress).toEqual([1, 2])
    expect(r.currentTokens).toHaveLength(2)
    expect(
      r.currentTokens[0]?.some((t) => t.surface === '黒鉄城' && t.pos === 'カスタム名詞'),
    ).toBe(true)
    const group = r.workVariants.groups.find((g) => g.forms.some((f) => f.base === '子供'))
    expect(group?.forms.map((f) => f.base).sort()).toEqual(['子ども', '子供'])
    expect(r.frequent[0]).toMatchObject({ base: 'ふと', count: 2 })
  })
})

describe('textsHash', () => {
  it('段落の並びと中身が同じなら同じ値', () => {
    expect(textsHash(['a', 'b'])).toBe(textsHash(['a', 'b']))
    expect(textsHash(['a', 'b'])).not.toBe(textsHash(['ab']))
    expect(textsHash(['a'])).not.toBe(textsHash(['b']))
  })
})
