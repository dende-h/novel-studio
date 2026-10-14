import { describe, expect, it } from 'vitest'
import { doubledParticleHits } from './doubled-particle'
import { sampleTokens } from './fixtures'

const hits = (text: string) => doubledParticleHits(sampleTokens(text), text).map((h) => h.text)

describe('一文の中の同じ助詞（FR-8b）', () => {
  it('間に別の助詞も読点も挟まずに同じ助詞が 2 回出たら、1 つ目から 2 つ目までを 1 件', () => {
    expect(hits('材料不足で代替素材で製品を作った。')).toEqual(['で代替素材で'])
    expect(hits('私は彼は好きだ。')).toEqual(['は彼は'])
    expect(hits('私は昇降口で靴箱の前で立ち止まった。')).toEqual([])
  })
  it('読点・別の助詞・並立・係助詞「も」を挟む場合は出さない', () => {
    for (const t of [
      '私は、彼は好きだ。',
      '彼は家に帰り、私は駅に向かった。',
      '私も彼も笑った。',
      '山や川や海を見た。',
    ]) {
      expect(hits(t), t).toEqual([])
    }
  })
  it('述語を挟む（別の節の助詞）なら出さない', () => {
    expect(hits('何かが動いた気がした。')).toEqual([])
    expect(hits('彼が来たのが嬉しかった。')).toEqual([])
  })
  it('隣り合う「がが」は「同じ語の連続」に任せる', () => {
    expect(hits('非常口の緑の光がが揺れて')).toEqual([])
  })
  it('説明に助詞を添える', () => {
    const text = '材料不足で代替素材で製品を作った。'
    expect(doubledParticleHits(sampleTokens(text), text)[0]?.message).toBe(
      '同じ文の中で「で」が続いています。言い換えると読みやすくなることがあります。',
    )
  })
})
