import { describe, expect, it } from 'vitest'
import { dataUrlMime, decodeDataUrl, fitWithin, squareCropRect } from '.'

describe('fitWithin（表紙用・比率維持の長辺クランプ）', () => {
  it('長辺が max 以下なら寸法不変・needsResize=false（拡大しない）', () => {
    expect(fitWithin(800, 600, 1400)).toEqual({ width: 800, height: 600, needsResize: false })
  })

  it('ちょうど max でも縮小しない', () => {
    expect(fitWithin(1400, 700, 1400)).toEqual({ width: 1400, height: 700, needsResize: false })
  })

  it('縦長：長辺(h)を max に合わせ比率維持で縮小', () => {
    expect(fitWithin(1000, 2000, 1400)).toEqual({ width: 700, height: 1400, needsResize: true })
  })

  it('横長：長辺(w)を max に合わせ比率維持で縮小（丸め）', () => {
    expect(fitWithin(3000, 2000, 1400)).toEqual({ width: 1400, height: 933, needsResize: true })
  })
})

describe('squareCropRect（サムネ用・中央正方形クロップ）', () => {
  it('横長：高さを一辺に中央切り出し、出力は max にクランプ', () => {
    expect(squareCropRect(1200, 800, 256)).toEqual({ sx: 200, sy: 0, side: 800, dSize: 256 })
  })

  it('縦長：幅を一辺に中央切り出し', () => {
    expect(squareCropRect(800, 1200, 256)).toEqual({ sx: 0, sy: 200, side: 800, dSize: 256 })
  })

  it('元が小さいときは拡大しない（dSize=side）', () => {
    expect(squareCropRect(100, 150, 256)).toEqual({ sx: 0, sy: 25, side: 100, dSize: 100 })
  })

  it('正方形はオフセット 0', () => {
    expect(squareCropRect(500, 500, 256)).toEqual({ sx: 0, sy: 0, side: 500, dSize: 256 })
  })
})

describe('dataUrlMime', () => {
  it('data URL から mime を読む', () => {
    expect(dataUrlMime('data:image/jpeg;base64,AAAA')).toBe('image/jpeg')
  })

  it('data URL でなければ null', () => {
    expect(dataUrlMime('https://example.com/a.jpg')).toBeNull()
  })
})

describe('decodeDataUrl', () => {
  it('base64 data URL を Uint8Array に復号', () => {
    // "Hi" → base64 "SGk="
    const bytes = decodeDataUrl('data:application/octet-stream;base64,SGk=')
    expect(Array.from(bytes)).toEqual([72, 105])
  })

  it('base64 でない data URL は throw', () => {
    expect(() => decodeDataUrl('data:text/plain,hello')).toThrow()
  })

  it('data URL でなければ throw', () => {
    expect(() => decodeDataUrl('not-a-data-url')).toThrow()
  })
})
