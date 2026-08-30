import { describe, expect, it } from 'vitest'
import {
  buildGameCredits,
  DEFAULT_BG_KEY,
  PRESET_BACKGROUNDS,
  presetBackground,
  presetBgSvg,
} from './presets'

describe('PRESET_BACKGROUNDS（8場所×3時間帯）', () => {
  it('24枚あり、キー・slug・ラベルが一意', () => {
    expect(PRESET_BACKGROUNDS).toHaveLength(24)
    const uniq = (xs: string[]) => new Set(xs).size
    expect(uniq(PRESET_BACKGROUNDS.map((p) => p.key))).toBe(24)
    expect(uniq(PRESET_BACKGROUNDS.map((p) => p.slug))).toBe(24)
    expect(uniq(PRESET_BACKGROUNDS.map((p) => p.label))).toBe(24)
  })

  it('キーは preset:bg/<place>-<time> の形', () => {
    for (const p of PRESET_BACKGROUNDS) {
      expect(p.key).toBe(`preset:bg/${p.place}-${p.time}`)
      expect(p.key).toBe(`preset:bg/${p.slug}`)
    }
  })

  it('既定背景キーは実在する', () => {
    expect(presetBackground(DEFAULT_BG_KEY)).toBeDefined()
  })

  it('presetBackground は未知キーに undefined', () => {
    expect(presetBackground('user:abc')).toBeUndefined()
  })
})

describe('presetBgSvg（テンプレ背景の実体）', () => {
  it('決定的（同じキーなら同じバイト列）で、トーン3色を含む SVG になる', () => {
    const p = presetBackground('preset:bg/room-night')
    if (!p) throw new Error('preset:bg/room-night が無い')
    const svg = presetBgSvg(p)
    expect(presetBgSvg(p)).toBe(svg)
    expect(svg.startsWith('<svg ')).toBe(true)
    for (const c of p.tone) expect(svg).toContain(c)
  })

  it('全24枚が生成できる', () => {
    for (const p of PRESET_BACKGROUNDS) {
      expect(presetBgSvg(p)).toContain('</svg>')
    }
  })
})

describe('buildGameCredits（使用素材から機械的に生成）', () => {
  it('背景・フォント・制作ツールの行を組み立てる', () => {
    const lines = buildGameCredits({ bgLabels: ['室内（夜）', '道（夜）'], fontEmbedded: true })
    expect(lines.map((l) => l.label)).toEqual(['背景', 'フォント', '制作ツール'])
    expect(lines[0]?.body).toContain('室内（夜）・道（夜）')
    expect(lines[1]?.body).toContain('SIL Open Font License')
  })

  it('フォント非同梱ならフォント行を出さない', () => {
    const lines = buildGameCredits({ bgLabels: ['抽象（夜）'], fontEmbedded: false })
    expect(lines.map((l) => l.label)).toEqual(['背景', '制作ツール'])
  })
})
