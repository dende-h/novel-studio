import { describe, expect, it } from 'vitest'
import { autoVariantHits, countAutoVariants, isSpellingVariant } from './auto-variant'
import { sampleTokens } from './fixtures'

const none = new Set<string>()

describe('isSpellingVariant', () => {
  it('漢字とかな・送り仮名・ひらがなとカタカナの違いだけを書き分けとみなす', () => {
    for (const [a, b] of [
      ['子供', '子ども'],
      ['分かる', 'わかる'],
      ['行う', '行なう'],
      ['事', 'こと'],
      ['ドキドキ', 'どきどき'],
    ]) {
      expect(isSpellingVariant(a as string, b as string), `${a}/${b}`).toBe(true)
    }
    for (const [a, b] of [
      ['暑い', '熱い'],
      ['会う', '合う'],
      ['子供', '子供'],
    ]) {
      expect(isSpellingVariant(a as string, b as string), `${a}/${b}`).toBe(false)
    }
  })
})

describe('表記ゆれの自動発見（FR-8a）', () => {
  const work = (texts: string[]) => texts.map((t) => sampleTokens(t))

  it('同じ読み・品詞で書き分けた語を、作品全体で数えて出現ごとに拾う', () => {
    const texts = ['子供と子どもが遊ぶ。', '分かる。わかる。分かった。わかった。', '行う。行なう。']
    const counts = countAutoVariants(work(texts), none)
    const text = '子供と子どもが遊ぶ。'
    const hits = autoVariantHits(sampleTokens(text), counts, none)
    expect(hits.map((h) => h.text)).toEqual(['子供', '子ども'])
    expect(hits[0]?.message).toBe(
      '「子供」と「子ども」が混ざっています（この作品で 子供 1件・子ども 1件）。どちらかに揃えると読みやすくなります。',
    )
    const wakaru = '分かる。わかる。分かった。わかった。'
    expect(autoVariantHits(sampleTokens(wakaru), counts, none).map((h) => h.text)).toEqual([
      '分かる',
      'わかる',
      '分かっ',
      'わかっ',
    ])
    expect(autoVariantHits(sampleTokens('行う。行なう。'), counts, none)).toHaveLength(2)
  })
  it('形式名詞・補助動詞のひらき（事／こと・〜て行く／〜ていく）も拾う', () => {
    const text = '急いで行った事がある。そのことを忘れて行く。忘れていく。'
    const counts = countAutoVariants(work([text]), none)
    expect(autoVariantHits(sampleTokens(text), counts, none).map((h) => h.text)).toEqual([
      '行っ',
      '事',
      'こと',
      '行く',
      'いく',
    ])
  })
  it('漢字が違う同音語は拾わない', () => {
    const text = '暑い日と熱い湯。人に会う。話が合う。'
    const counts = countAutoVariants(work([text]), none)
    expect(autoVariantHits(sampleTokens(text), counts, none)).toEqual([])
  })
  it('固有名詞と用語集の語は外す', () => {
    const texts = ['子供と子どもが遊ぶ。', '宮森は言った。']
    const excluded = new Set(['子供'])
    const counts = countAutoVariants(work(texts), excluded)
    expect(autoVariantHits(sampleTokens('子供と子どもが遊ぶ。'), counts, excluded)).toEqual([])
    expect(countAutoVariants(work(['宮森は言った。']), none).groups).toEqual([])
  })
})
