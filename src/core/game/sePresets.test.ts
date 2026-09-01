import { describe, expect, it } from 'vitest'
import { PRESET_SES, presetSe, seDuration } from './sePresets'

describe('テンプレ効果音（合成レシピ8種）', () => {
  it('8種のキーが一意で、preset:se/ の形を持つ', () => {
    expect(PRESET_SES).toHaveLength(8)
    const keys = PRESET_SES.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of PRESET_SES) {
      expect(p.key).toBe(`preset:se/${p.slug}`)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.steps.length).toBeGreaterThan(0)
    }
  })

  it('presetSe はキーで引ける（未知キーは undefined）', () => {
    expect(presetSe('preset:se/rain')?.label).toBe('雨')
    expect(presetSe('preset:se/nowhere')).toBeUndefined()
  })

  it('レシピは安全な範囲に収まる（音量 0..1・長さ 5 秒以内・周波数は正）', () => {
    for (const p of PRESET_SES) {
      expect(seDuration(p)).toBeLessThanOrEqual(5)
      for (const s of p.steps) {
        expect(s.d).toBeGreaterThan(0)
        if (s.g !== undefined) {
          expect(s.g).toBeGreaterThan(0)
          expect(s.g).toBeLessThanOrEqual(1)
        }
        // 指数スイープ（exponentialRamp）は 0 を扱えない——0 や負の周波数を仕込まない
        for (const v of [s.f, s.f2, s.lp, s.lp2]) {
          if (v !== undefined) expect(v).toBeGreaterThan(0)
        }
        if (s.w !== 'noise') expect(s.f).toBeGreaterThan(0)
      }
    }
  })
})
