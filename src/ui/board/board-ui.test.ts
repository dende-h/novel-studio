import { describe, expect, it } from 'vitest'
import {
  BOARD_KINDS,
  BOARD_STATUSES,
  boardKindLabel,
  boardStatusLabel,
  canonicalKind,
} from '@/core/board/types'
import { formatRelative } from '@/ui/_utils/format'
import {
  creatableKindOrder,
  excerptOf,
  formatBoardTime,
  KIND_UI,
  kindOrder,
  STATUS_UI,
} from './board-ui'

describe('KIND_UI / kindOrder', () => {
  // 表に漏れがあると、その種別のスレだけチップが引けず一覧が空白になる。
  it('種別の全部を網羅し、ラベルは types.ts と同じ', () => {
    for (const kind of BOARD_KINDS) {
      const ui = KIND_UI[kind]
      expect(ui.label).toBe(boardKindLabel[kind])
      expect(ui.className).not.toBe('')
    }
    expect(Object.keys(KIND_UI).sort()).toEqual([...BOARD_KINDS].sort())
  })

  it('並びは お知らせ・要望・不具合・雑談・自己紹介・作品紹介', () => {
    expect(kindOrder).toEqual(['notice', 'request', 'bug', 'chat', 'intro', 'promo'])
  })

  it('絞り込みタブに廃止した種別を出さない（「要望」のタブが 2 つ並ばない）', () => {
    expect(kindOrder).not.toContain('suggestion')
    // 出すのは「いま生きている種別」の全部。1 つでも落ちるとその種別が開けなくなる。
    expect([...kindOrder].sort()).toEqual(
      BOARD_KINDS.filter((kind) => kind !== 'event' && canonicalKind(kind) === kind).sort(),
    )
    // ラベルは重複しない（同じ表記のタブが並ぶと、どちらを押せばよいか分からない）
    const labels = kindOrder.map((kind) => KIND_UI[kind].label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('統合した目安箱は要望と同じ見た目・同じラベル', () => {
    // 見た目が割れていると、統合したのに 2 種類が並んで見える。
    expect(KIND_UI.suggestion.label).toBe(KIND_UI.request.label)
    expect(KIND_UI.suggestion.className).toBe(KIND_UI.request.className)
  })

  it('お知らせだけ一覧の行を目立たせる（運営からの連絡なので）', () => {
    expect(KIND_UI.notice.rowClassName).not.toBe('')
    for (const kind of BOARD_KINDS) {
      if (kind === 'notice') continue
      expect(KIND_UI[kind].rowClassName).toBe('')
    }
    // チップの塗りつぶしも掲示板で 2 つだけ（お知らせと、実装済みのステータス）
    expect(KIND_UI.notice.className).toContain('bg-primary ')
  })
})

describe('creatableKindOrder', () => {
  it('member にはお知らせを出さない（押してから 403 で断らない）', () => {
    expect(creatableKindOrder('member')).toEqual(['request', 'bug', 'chat', 'intro', 'promo'])
  })

  it('staff にはお知らせも出す。並びは kindOrder のまま', () => {
    expect(creatableKindOrder('staff')).toEqual(kindOrder)
  })

  it('廃止した種別はどちらの立場でも選べない', () => {
    expect(creatableKindOrder('member')).not.toContain('suggestion')
    expect(creatableKindOrder('staff')).not.toContain('suggestion')
  })
})

describe('STATUS_UI', () => {
  it('ステータスの全部を網羅し、ラベルは types.ts と同じ', () => {
    for (const status of BOARD_STATUSES) {
      expect(STATUS_UI[status].label).toBe(boardStatusLabel[status])
    }
    expect(Object.keys(STATUS_UI).sort()).toEqual([...BOARD_STATUSES].sort())
  })

  it('未設定はチップを出さない（ラベルもクラスも空）', () => {
    expect(STATUS_UI[''].label).toBe('')
    expect(STATUS_UI[''].className).toBe('')
    expect(STATUS_UI[''].emphasis).toBe(false)
  })

  it('実装済みだけを目立たせる', () => {
    expect(STATUS_UI.shipped.emphasis).toBe(true)
    const others = BOARD_STATUSES.filter((s) => s !== 'shipped')
    for (const status of others) expect(STATUS_UI[status].emphasis).toBe(false)
    // 塗りつぶしは shipped の 1 つだけ（複数あると「進捗が見える」効きが薄れる）
    expect(STATUS_UI.shipped.className).toContain('bg-primary ')
  })

  it('未設定を除く全部にクラスが入っている', () => {
    for (const status of BOARD_STATUSES) {
      if (status === '') continue
      expect(STATUS_UI[status].className).not.toBe('')
    }
  })
})

describe('formatBoardTime', () => {
  const now = Date.UTC(2026, 7, 28, 12, 0, 0)

  it('アプリ共通の formatRelative に委ねる', () => {
    expect(formatBoardTime(now - 90_000, now)).toBe(formatRelative(now - 90_000, now))
    expect(formatBoardTime(now - 90_000, now)).toBe('1分前')
  })

  it('時刻が無いときは空文字（1970 年を出さない）', () => {
    expect(formatBoardTime(0, now)).toBe('')
    expect(formatBoardTime(Number.NaN, now)).toBe('')
  })
})

describe('excerptOf', () => {
  it('記法の記号を落として 1 行に畳む', () => {
    expect(excerptOf('## 見出し\n\n本文です')).toBe('見出し 本文です')
  })

  it('上限を超えたら丸めて … を付ける', () => {
    expect(excerptOf('あいうえお', 3)).toBe('あいう…')
    expect(excerptOf('あいうえお', 5)).toBe('あいうえお')
  })

  // 絵文字を真ん中で割ると壊れた文字が一覧に出る。
  it('サロゲートペアを割らない', () => {
    expect(excerptOf('🌱🌱🌱', 2)).toBe('🌱🌱…')
  })

  it('空・未指定で落ちない', () => {
    expect(excerptOf('')).toBe('')
    expect(excerptOf(undefined)).toBe('')
    expect(excerptOf('あいうえお', 0)).toBe('')
  })
})
