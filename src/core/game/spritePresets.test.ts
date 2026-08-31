import { describe, expect, it } from 'vitest'
import { decodeDataUrl } from '../image'
import { PRESET_SPRITES, presetSprite, presetSpriteDataUrl, presetSpriteSvg } from './spritePresets'

describe('テンプレ立ち絵（シルエット6種）', () => {
  it('6種のキーが一意で、preset:sprite/ の形を持つ', () => {
    expect(PRESET_SPRITES).toHaveLength(6)
    const keys = PRESET_SPRITES.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of PRESET_SPRITES) {
      expect(p.key).toBe(`preset:sprite/${p.slug}`)
      expect(p.label).toContain('シルエット')
    }
  })

  it('presetSprite はキーで引ける（未知キーは undefined）', () => {
    const first = PRESET_SPRITES[0]!
    expect(presetSprite(first.key)).toBe(first)
    expect(presetSprite('preset:sprite/nowhere')).toBeUndefined()
  })

  it('SVG は決定的で、図形を持ち、script を含まない', () => {
    for (const p of PRESET_SPRITES) {
      const svg = presetSpriteSvg(p)
      expect(svg).toBe(presetSpriteSvg(p))
      expect(svg).toContain('viewBox="0 0 480 960"')
      expect(svg).toMatch(/<(path|circle|ellipse|rect)/)
      expect(svg).not.toContain('<script')
    }
  })

  it('data URL は base64 で、書き出しの decodeDataUrl がそのまま解ける', () => {
    const p = PRESET_SPRITES[0]!
    const dataUrl = presetSpriteDataUrl(p)
    expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const decoded = new TextDecoder().decode(decodeDataUrl(dataUrl))
    expect(decoded).toBe(presetSpriteSvg(p))
  })
})
