import { describe, expect, it } from 'vitest'
import { sampleTokens } from './fixtures'
import { raNukiHits } from './ra-nuki'

const hits = (text: string) => raNukiHits(sampleTokens(text), text)

describe('ら抜き言葉（FR-8c）', () => {
  it('一段動詞の未然形＋「れる」と、1 語の「来れる」「見れる」を拾う', () => {
    expect(hits('食べれる。起きれる。寝れない。来れない。見れる。').map((h) => h.text)).toEqual([
      '食べれる',
      '起きれる',
      '寝れ',
      '来れ',
      '見れる',
    ])
  })
  it('正しい形と、もとから「れる」で終わる動詞は拾わない', () => {
    expect(hits('食べられる。来られる。入れる。帰れる。読める。')).toEqual([])
  })
  it('括弧の中（会話文）は調べない', () => {
    expect(hits('「ここからでも見れるよ」と彼は言った。')).toEqual([])
    const text = '「ここから見れるよ」と言ったが、私には見れなかった。'
    expect(hits(text).map((h) => [h.text, h.start])).toEqual([['見れ', text.lastIndexOf('見れ')]])
  })
  it('説明に正しい形を添える', () => {
    const [first, , , kure] = hits('食べれる。起きれる。寝れない。来れない。見れる。')
    expect(first?.message).toBe(
      '「食べれる」はら抜き言葉です。地の文では「食べられる」が一般的です。',
    )
    expect(kure?.message).toBe('「来れ」はら抜き言葉です。地の文では「来られ」が一般的です。')
  })
  it('例外（COT-62）のキーは原形のら抜きの形。活用が違っても同じキー', () => {
    expect(hits('食べれる。起きれる。寝れない。来れない。見れる。').map((h) => h.rule)).toEqual([
      { key: 'ra-nuki:食べれる', label: '食べれる' },
      { key: 'ra-nuki:起きれる', label: '起きれる' },
      { key: 'ra-nuki:寝れる', label: '寝れる' },
      { key: 'ra-nuki:来れる', label: '来れる' },
      { key: 'ra-nuki:見れる', label: '見れる' },
    ])
  })
})
