import { describe, expect, it } from 'vitest'
import { PRESET_SES, presetSe, seDuration, sePeriod } from './sePresets'

describe('組み込みの効果音（合成レシピ）', () => {
  it('12 種のキーが一意で、preset:se/ の形を持つ', () => {
    expect(PRESET_SES).toHaveLength(12)
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
    expect(presetSe('preset:se/wave')?.label).toBe('波')
    expect(presetSe('preset:se/nowhere')).toBeUndefined()
  })

  it('レシピは安全な範囲に収まる（音量 0..1・長さ 5 秒以内・周波数は正・揺らぎと残響は 0..1）', () => {
    for (const p of PRESET_SES) {
      expect(seDuration(p)).toBeLessThanOrEqual(5)
      for (const s of p.steps) {
        expect(s.d).toBeGreaterThan(0)
        if (s.g !== undefined) {
          expect(s.g).toBeGreaterThan(0)
          expect(s.g).toBeLessThanOrEqual(1)
        }
        // 立ち上がり＋保持が全体の長さを超えない（超えると減衰の予約が過去になる）
        expect((s.a ?? 0.015) + (s.s ?? 0)).toBeLessThanOrEqual(s.d)
        // 指数スイープ（exponentialRamp）は 0 を扱えない——0 や負の周波数を仕込まない
        for (const v of [s.f, s.f2, s.lp, s.lp2, s.hp, s.bp, s.bp2, s.q, s.mf]) {
          if (v !== undefined) expect(v).toBeGreaterThan(0)
        }
        for (const v of [s.md, s.rv]) {
          if (v !== undefined) {
            expect(v).toBeGreaterThan(0)
            expect(v).toBeLessThanOrEqual(1)
          }
        }
        const isNoise = s.w === 'noise' || s.w === 'pink' || s.w === 'brown'
        if (!isNoise) expect(s.f).toBeGreaterThan(0)
      }
    }
  })

  it('環境音（雨・風・波）はループの周期がレシピより短い＝重ねて継ぎ目を消す', () => {
    for (const slug of ['rain', 'wind', 'wave']) {
      const p = presetSe(`preset:se/${slug}`)
      if (!p) throw new Error(slug)
      expect(p.period).toBeDefined()
      expect(sePeriod(p)).toBeLessThan(seDuration(p))
      expect(sePeriod(p)).toBeGreaterThan(seDuration(p) * 0.6)
    }
    // 周期の無いものは長さがそのまま周期
    const bell = presetSe('preset:se/bell')
    if (!bell) throw new Error('bell')
    expect(sePeriod(bell)).toBe(seDuration(bell))
  })
})
