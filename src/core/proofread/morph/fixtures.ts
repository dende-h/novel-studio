import samples from './__fixtures__/samples.json'
import { type MorphToken, toMorphTokens } from './token'

/** 実際の lindera（IPADIC）の出力を固定したもの（scripts/gen-morph-fixtures.mjs で作る）。テスト専用。 */
export function sampleTokens(text: string): MorphToken[] {
  const s = (samples as { text: string; raw: string[][] }[]).find((x) => x.text === text)
  if (!s) throw new Error(`フィクスチャに無い例文です（gen-morph-fixtures.mjs に足す）: ${text}`)
  return toMorphTokens(s.raw, text)
}
