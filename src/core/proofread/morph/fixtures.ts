import names from './__fixtures__/names.json'
import samples from './__fixtures__/samples.json'
import { type MorphToken, toMorphTokens } from './token'

/** 実際の lindera（IPADIC）の出力を固定したもの（scripts/gen-morph-fixtures.mjs で作る）。テスト専用。 */
export function sampleTokens(text: string): MorphToken[] {
  const s = (samples as { text: string; raw: string[][] }[]).find((x) => x.text === text)
  if (!s) throw new Error(`フィクスチャに無い例文です（gen-morph-fixtures.mjs に足す）: ${text}`)
  return toMorphTokens(s.raw, text)
}

/** 名前の候補（COT-59）の例文。いまの辞書（SudachiDict を足した IPADIC）の出力を固定したもの。 */
export function nameSampleTokens(text: string): MorphToken[] {
  const s = (names as { text: string; raw: string[][] }[]).find((x) => x.text === text)
  if (!s)
    throw new Error(`フィクスチャに無い例文です（gen-morph-fixtures.mjs --names に足す）: ${text}`)
  return toMorphTokens(s.raw, text)
}
