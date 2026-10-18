// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import fictionalNames from '@/core/proofread/morph/__fixtures__/fictional-names.json'
import samples from '@/core/proofread/morph/__fixtures__/samples.json'
import { createAnalyzerEngine, type LinderaLike, textsHash } from './analyzer-engine'
import { DICT_URL } from './protocol'
import { unzipEntries } from './unzip'

/**
 * 解析の本体を、実物の lindera-wasm と辞書 zip で動かす（COT-40）。
 * 辞書は scripts/fetch-dict.mjs（pretest）が public/dict/ に置く。CI では必ずあるので、無ければ失敗させる。
 */
const zipPath = resolve(process.cwd(), 'public/dict/lindera-ipadic-6.2.0-sudachi20260723.zip')
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

/** 実物の辞書で文を解析する（ユーザー辞書なし）。 */
async function loadTokenizer() {
  const lindera = await loadLindera()
  const files = await unzipEntries(new Uint8Array(readFileSync(zipPath)))
  const names = [
    'metadata.json',
    'dict.trie',
    'dict.valsidx',
    'dict.vals',
    'dict.wordsidx',
    'dict.words',
    'matrix.mtx',
    'char_def.bin',
    'unk.bin',
  ]
  const dict = lindera.loadDictionaryFromBytes(...names.map((n) => files.get(n) as Uint8Array))
  const builder = new lindera.TokenizerBuilder()
  builder.setDictionaryInstance(dict)
  builder.setMode('normal')
  builder.setKeepWhitespace(true)
  return builder.build()
}

/**
 * 今の言葉を足した辞書（COT-59 FR-1）。samples.json は COT-40 の辞書（lindera 配布の IPADIC）の出力で、
 * 作り直さずに基準として残している。架空の名前の基準の数も、COT-40 の辞書で数えた値。
 */
const FICTIONAL_NAMES_KEPT_BY_OLD_DICT = 55

run('今の言葉を足した辞書（COT-59）', () => {
  it('今の言葉を1語の名詞にし、普通の語の一部を人名にしない', async () => {
    const tokenizer = await loadTokenizer()
    const cases: [string, string[]][] = [
      ['コーヒーをテーブルに置いて、スマートフォンを見た。', ['スマートフォン']],
      ['スマホのガチャでコスパのいい課金をした。', ['スマホ', 'ガチャ', 'コスパ']],
      ['既読スルーされたまま', ['既読スルー']],
      ['王都グランヴェルの城門を、黒鉄騎士団が固めていた。', ['王都', '黒鉄']],
    ]
    for (const [text, words] of cases) {
      const tokens = tokenizer.tokenize(text)
      for (const w of words) {
        const t = tokens.find((x) => x.surface === w)
        expect(t?.details[0], `${text} の ${w}`).toBe('名詞')
        expect(t?.details[1], `${text} の ${w}`).not.toBe('固有名詞')
      }
      expect(
        tokens.some((x) => x.details[2] === '人名'),
        text,
      ).toBe(false)
    }
  })

  it('品詞ルールの例文（samples.json）の区切りが COT-40 の辞書と同じ', async () => {
    const tokenizer = await loadTokenizer()
    for (const s of samples as { text: string; raw: string[][] }[]) {
      expect(
        tokenizer.tokenize(s.text).map((t) => t.surface),
        s.text,
      ).toEqual(s.raw.map((r) => r[0]))
    }
  })

  it('架空の名前を、COT-40 の辞書と同じかそれ以上に1語のまま残す', async () => {
    const tokenizer = await loadTokenizer()
    const kept = (fictionalNames as string[]).filter((n) =>
      tokenizer
        .tokenize(`「待って」${n}は振り返った。${n}の声が響く。`)
        .some((t) => t.surface === n),
    )
    expect(fictionalNames).toHaveLength(61)
    expect(kept.length).toBeGreaterThanOrEqual(FICTIONAL_NAMES_KEPT_BY_OLD_DICT)
  })

  it('zip は 13MB 以下で、名前が scripts/dict-file.mjs・protocol.ts とそろう', () => {
    expect(statSync(zipPath).size).toBeLessThanOrEqual(13_000_000)
    const shared = readFileSync(resolve(process.cwd(), 'scripts/dict-file.mjs'), 'utf8').match(
      /DICT_FILE = '([^']+)'/u,
    )?.[1]
    expect(shared).toBeTruthy()
    expect(DICT_URL).toBe(`/dict/${shared}`)
    expect(zipPath.endsWith(`/${shared}`)).toBe(true)
  })

  it('作品全体から名前の候補を返す（ルビ・[[ ]]・用語集の語を除く）', async () => {
    const engine = createAnalyzerEngine(
      await loadLindera(),
      async () => new Uint8Array(readFileSync(zipPath)),
    )
    await engine.init('宮森,カスタム名詞,ミヤモリ\n', ['宮森'])
    const e1 = [
      '「リリアーナ様、お待ちください」',
      '　宮森さんは黒鉄騎士団の旗を見た。憂鬱な朝だった。',
    ]
    const e2 = ['　リリアーナは振り返らない。シェリスが肩をすくめる。']
    const r = engine.analyze(
      [
        {
          id: 'e1',
          hash: textsHash(e1),
          texts: e1,
          rubies: [
            { base: '黒鉄', reading: 'くろがね' },
            { base: '憂鬱', reading: 'ゆううつ' },
          ],
        },
        { id: 'e2', hash: textsHash(e2), texts: e2, refs: ['シェリス'] },
      ],
      'e1',
    )
    const byName = new Map(r.names.map((c) => [c.name, c]))
    expect(byName.get('リリアーナ')).toMatchObject({ count: 2, episodes: 2, category: '人物' })
    expect(byName.get('黒鉄')).toMatchObject({ reading: 'くろがね' })
    expect(byName.has('シェリス')).toBe(true)
    expect(byName.has('憂鬱')).toBe(false)
    expect(byName.has('宮森')).toBe(false)
  })

  it('全角空白を半角に替えてから解析し、字下げや「！　」が次の語の解析を崩さない（位置はずれない）', async () => {
    const engine = createAnalyzerEngine(
      await loadLindera(),
      async () => new Uint8Array(readFileSync(zipPath)),
    )
    await engine.init('', [])
    const texts = [
      '　灯里ちゃんが手を振る。湊斗は灯里に笑い返した。',
      '「待って！　すぐ終わるから」',
    ]
    const r = engine.analyze([{ id: 'e1', hash: textsHash(texts), texts }], 'e1')
    const [first, second] = r.currentTokens
    expect(first?.find((t) => t.surface === '灯')).toMatchObject({ pos1: '一般', start: 1 })
    expect(second?.find((t) => t.surface === '！')).toMatchObject({ pos: '記号', start: 4 })
    for (const [i, tokens] of r.currentTokens.entries()) {
      for (const t of tokens) {
        if (t.surface.trim()) expect(texts[i]?.slice(t.start, t.end)).toBe(t.surface)
      }
    }
    expect(r.names.find((c) => c.name === '灯里')).toMatchObject({ category: '人物' })
    expect(r.names.some((c) => c.name === '里')).toBe(false)
  })
})

describe('textsHash', () => {
  it('段落の並びと中身が同じなら同じ値', () => {
    expect(textsHash(['a', 'b'])).toBe(textsHash(['a', 'b']))
    expect(textsHash(['a', 'b'])).not.toBe(textsHash(['ab']))
    expect(textsHash(['a'])).not.toBe(textsHash(['b']))
  })
})
