import { describe, expect, it } from 'vitest'
import type { DailyActivity } from '@/core/activity'
import { buildShareCardData, shareCardText } from './share-card'

const day = (date: string, net: number): DailyActivity => ({
  date,
  added: Math.max(0, net),
  removed: Math.max(0, -net),
  net,
  saves: 1,
  updatedAt: 1,
})

describe('共有カードのデータ組み立て（純ロジック）', () => {
  it('今日の字数・連続日数・通算・草・日付ラベルを組む', () => {
    const days = [day('2026-08-16', 300), day('2026-08-17', 500), day('2026-08-18', 1200)]
    const data = buildShareCardData(days, '2026-08-18')
    expect(data.todayChars).toBe(1200)
    expect(data.streak).toBe(3)
    expect(data.totalNet).toBe(2000)
    expect(data.dateLabel).toBe('2026年8月18日')
    expect(data.heatmap.length).toBe(17) // 直近 17 週
    const flat = data.heatmap.flat()
    expect(flat.find((c) => c.date === '2026-08-18')?.level).toBeGreaterThan(0)
  })

  it('shareCardText: 書いた日は字数、書いていない日は連続日数、どちらも無ければ汎用文', () => {
    expect(shareCardText({ todayChars: 1200, streak: 3 })).toContain('今日は 1,200字 書きました')
    expect(shareCardText({ todayChars: 1200, streak: 3 })).toContain('（連続3日）')
    expect(shareCardText({ todayChars: 1200, streak: 1 })).not.toContain('連続')
    expect(shareCardText({ todayChars: 0, streak: 5 })).toContain('連続5日、書いています')
    expect(shareCardText({ todayChars: 0, streak: 0 })).toContain('執筆の記録')
    // 共通：ハッシュタグとアプリの URL が必ず入る（投稿がそのまま紹介になる）
    expect(shareCardText({ todayChars: 0, streak: 0 })).toContain('#コトノハleaf')
    expect(shareCardText({ todayChars: 0, streak: 0 })).toContain('https://cotonoha-leaf.org')
  })
})
