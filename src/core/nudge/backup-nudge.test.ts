import { describe, expect, it } from 'vitest'
import {
  decideBackupNudge,
  kanjiInt,
  kanjiMan,
  NUDGE_COOLDOWN_MS,
  type NudgeAck,
  type NudgeMarks,
} from './backup-nudge'

const now = 1_700_000_000_000
const noAck: NudgeAck = { charLevel: 0, dayLevel: 0, dismissedAt: 0 }
const noBackup: NudgeMarks = { localBackupAt: null, localBackupChars: null, cloudBackupAt: null }
const base = { totalChars: 0, activeDays: 0, marks: noBackup, ack: noAck, now }

describe('kanjiInt / kanjiMan', () => {
  it('十百千の位取りを漢数字にする', () => {
    expect(kanjiInt(3)).toBe('三')
    expect(kanjiInt(14)).toBe('十四')
    expect(kanjiInt(30)).toBe('三十')
    expect(kanjiInt(102)).toBe('百二')
    expect(kanjiMan(3)).toBe('三万')
    expect(kanjiMan(12)).toBe('十二万')
  })
})

describe('decideBackupNudge', () => {
  it('節目を跨いでいなければ出さない', () => {
    expect(decideBackupNudge({ ...base, totalChars: 29_999, activeDays: 13 }).show).toBe(false)
  })

  it('三万字の節目を跨いだら出す（未バックアップ＝never 文面）', () => {
    const d = decideBackupNudge({ ...base, totalChars: 30_000 })
    expect(d.show).toBe(true)
    if (d.show) {
      expect(d.headline).toBe('三万字を越えました！')
      expect(d.body).toEqual({ kind: 'never' })
      expect(d.charLevel).toBe(1)
    }
  })

  it('十四日の節目を跨いだら出す（字数の節目が無ければ日数見出し）', () => {
    const d = decideBackupNudge({ ...base, totalChars: 5_000, activeDays: 14 })
    expect(d.show).toBe(true)
    if (d.show) {
      expect(d.headline).toBe('書いた日が十四日になりました。')
      expect(d.dayLevel).toBe(1)
    }
  })

  it('字数と日数を両方跨いだら字数の達成を優先してたたえる', () => {
    const d = decideBackupNudge({ ...base, totalChars: 60_000, activeDays: 28 })
    expect(d.show && d.headline).toBe('六万字を越えました！')
  })

  it('会員でなくても、すでに承認済みレベルなら出さない', () => {
    const ack: NudgeAck = { charLevel: 1, dayLevel: 0, dismissedAt: 0 }
    expect(decideBackupNudge({ ...base, totalChars: 30_000, ack }).show).toBe(false)
  })

  it('解散から 30 日のクールダウン中は、新しい節目でも出さない', () => {
    const ack: NudgeAck = { charLevel: 1, dayLevel: 0, dismissedAt: now - 1 }
    // 6万字＝新レベルだが、直前に解散したばかり。
    expect(decideBackupNudge({ ...base, totalChars: 60_000, ack }).show).toBe(false)
    // 30 日経てば出る。
    const later = { ...base, totalChars: 60_000, ack, now: now + NUDGE_COOLDOWN_MS + 1 }
    expect(decideBackupNudge(later).show).toBe(true)
  })

  it('前回バックアップから十分に書き足していれば delta 文面で出す', () => {
    const marks: NudgeMarks = {
      localBackupAt: now - 1000,
      localBackupChars: 20_000,
      cloudBackupAt: null,
    }
    const d = decideBackupNudge({ ...base, totalChars: 30_000, marks })
    expect(d.show).toBe(true)
    if (d.show) expect(d.body).toEqual({ kind: 'delta', chars: 10_000 })
  })

  it('最近バックアップ済み（書き足しがわずか）なら安全とみなし出さない', () => {
    const marks: NudgeMarks = {
      localBackupAt: now - 1000,
      localBackupChars: 29_500,
      cloudBackupAt: null,
    }
    // 30,000 字の節目は跨いだが、前回書き出しから 500 字しか増えていない＝安全。
    expect(decideBackupNudge({ ...base, totalChars: 30_000, marks }).show).toBe(false)
  })
})
