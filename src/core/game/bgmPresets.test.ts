import { describe, expect, it } from 'vitest'
import { PRESET_BGM_CATEGORY_LABELS, PRESET_BGMS, presetBgm, presetBgmBySlug } from './bgmPresets'
import { parseTemplateFilename } from './templates'

describe('組み込みの BGM プリセット（枠だけ・22 曲）', () => {
  it('22 曲のキーが一意で、preset:bgm/ の形を持つ', () => {
    expect(PRESET_BGMS).toHaveLength(22)
    const keys = PRESET_BGMS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of PRESET_BGMS) {
      expect(p.key).toBe(`preset:bgm/${p.slug}`)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.note.length).toBeGreaterThan(0)
    }
  })

  it('slug は目録の命名規則（bgm-<曲調>-<曲名>.mp3）に合い、曲調の語が分類になる', () => {
    for (const p of PRESET_BGMS) {
      const parsed = parseTemplateFilename(`${p.slug}.mp3`)
      expect(parsed).toEqual({ kind: 'bgm', slug: p.slug, category: p.category })
      expect(PRESET_BGM_CATEGORY_LABELS[p.category]).toBeDefined()
    }
  })

  it('4 つの曲調に分かれる（日常 4・感情 6・緊張 8・場面 4）', () => {
    const count = (c: string) => PRESET_BGMS.filter((p) => p.category === c).length
    expect(count('calm')).toBe(4)
    expect(count('emotion')).toBe(6)
    expect(count('tense')).toBe(8)
    expect(count('scene')).toBe(4)
  })

  it('キーと slug で引ける（未知は undefined）', () => {
    expect(presetBgm('preset:bgm/bgm-calm-bright')?.label).toBe('日常・明るい')
    expect(presetBgmBySlug('bgm-scene-hush')?.label).toBe('静かな緊張')
    expect(presetBgm('preset:bgm/nowhere')).toBeUndefined()
    expect(presetBgmBySlug('bgm-calm-morning')).toBeUndefined()
  })
})
