import { nameKeyOf, normalizeDisplayName, RESERVED_NAME_KEYS, validateDisplayName } from './name'
import { BOARD_LIMITS } from './types'

/**
 * 表示名の正規化・畳み込み・予約語の契約を固定する（設計書 §7-3）。
 * ここが緩むと「運営そっくりの名前」を取られるので、抜け道の入力を並べて塞ぐ。
 * 見えない文字はソース上で読めるようにエスケープ表記で書く。
 */

/** ゼロ幅スペース / ZWNJ / ZWJ / BOM / RLO / PDF（双方向制御）。 */
const ZWSP = '\u200B'
const ZWNJ = '\u200C'
const ZWJ = '\u200D'
const BOM = '\uFEFF'
const RLO = '\u202E'
const PDF = '\u202C'

describe('normalizeDisplayName', () => {
  it('前後の空白を落とし、連続空白を 1 つにする', () => {
    expect(normalizeDisplayName('  夏目  漱石　　石  ')).toBe('夏目 漱石 石')
  })

  it('ゼロ幅文字・双方向制御文字・制御文字を落とす', () => {
    expect(normalizeDisplayName(`太${ZWSP}郎${BOM}`)).toBe('太郎')
    expect(normalizeDisplayName(`${RLO}taro${PDF}`)).toBe('taro')
    expect(normalizeDisplayName(`a${ZWSP}b\tc\nd`)).toBe('ab c d')
  })

  it('NFKC で全角英数・半角カナを整える', () => {
    expect(normalizeDisplayName('Ｔａｒｏ１')).toBe('Taro1')
    expect(normalizeDisplayName('ｱﾘｽ')).toBe('アリス')
  })

  it('見える文字が無ければ空文字になる', () => {
    expect(normalizeDisplayName(`${ZWSP} ${ZWJ}${BOM}`)).toBe('')
  })
})

describe('nameKeyOf', () => {
  it('大小・全半角の違いを畳む', () => {
    expect(nameKeyOf('ＡＤＭＩＮ')).toBe(nameKeyOf('admin'))
    expect(nameKeyOf('Taro')).toBe(nameKeyOf('ｔａｒｏ'))
  })

  it('半角カナと全角カナ、濁点の形を畳む', () => {
    expect(nameKeyOf('ｶﾞｸ')).toBe(nameKeyOf('ガク'))
  })

  it('空白の入れ方では別名にならない', () => {
    expect(nameKeyOf('運 営')).toBe(nameKeyOf('運営'))
    expect(nameKeyOf('a d m i n')).toBe(nameKeyOf('admin'))
  })

  it('長音符・ハイフン・中黒の揺れを畳む', () => {
    expect(nameKeyOf('コーヒー')).toBe(nameKeyOf('コ-ヒ-'))
    expect(nameKeyOf('ジャン・ポール')).toBe(nameKeyOf('ジャンポール'))
    expect(nameKeyOf('a-d-m-i-n')).toBe(nameKeyOf('admin'))
  })

  it('ラテン文字に似たキリル文字・ギリシャ文字を畳む（成りすまし防止）', () => {
    // а はキリル小文字 а、о はキリル小文字 о、ο はギリシャ小文字 ο
    expect(nameKeyOf('аdmin')).toBe(nameKeyOf('admin'))
    expect(nameKeyOf('kоtоnоha')).toBe(nameKeyOf('kotonoha'))
    expect(nameKeyOf('grοve')).toBe(nameKeyOf('grove'))
  })

  it('見えない文字を挟んでも同じ鍵になる', () => {
    expect(nameKeyOf(`ad${ZWSP}min`)).toBe(nameKeyOf('admin'))
    expect(nameKeyOf(`ad${RLO}min`)).toBe(nameKeyOf('admin'))
  })

  it('本当に別の名前は別の鍵のまま', () => {
    expect(nameKeyOf('taro')).not.toBe(nameKeyOf('jiro'))
    expect(nameKeyOf('運営者たろう')).not.toBe(nameKeyOf('運営'))
  })
})

describe('RESERVED_NAME_KEYS', () => {
  it('nameKeyOf を通した形で持っている（鍵どうしで突き合わせられる）', () => {
    for (const key of RESERVED_NAME_KEYS) {
      expect(nameKeyOf(key)).toBe(key)
    }
    expect(RESERVED_NAME_KEYS.has(nameKeyOf('運営'))).toBe(true)
    expect(RESERVED_NAME_KEYS.has(nameKeyOf('admin'))).toBe(true)
  })
})

describe('validateDisplayName', () => {
  it('ふつうの名前は通り、正規化した name と key を返す', () => {
    const r = validateDisplayName('  夏目　漱石 ')
    expect(r).toEqual({ ok: true, name: '夏目 漱石', key: nameKeyOf('夏目漱石') })
  })

  it('空・見えない文字だけは empty', () => {
    expect(validateDisplayName('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateDisplayName(`  ${ZWSP} `)).toEqual({ ok: false, reason: 'empty' })
  })

  it('上限を超えたら too_long（上限ちょうどは通る）', () => {
    const max = 'あ'.repeat(BOARD_LIMITS.displayName)
    expect(validateDisplayName(max).ok).toBe(true)
    expect(validateDisplayName(`${max}あ`)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('記号や長音だけで鍵が空になる名前は invalid', () => {
    expect(validateDisplayName('---')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateDisplayName('・・・')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('予約語は表記ゆれでも弾く', () => {
    const evil = [
      '運営',
      '運 営',
      'ＡＤＭＩＮ',
      'Admin ',
      'admin',
      'A d m i n',
      'ＫＯＴＯＮＯＨＡ',
      'こ と の は',
      'Staff',
      'ｓｙｓｔｅｍ',
      '管理人',
    ]
    for (const raw of evil) {
      expect(validateDisplayName(raw)).toEqual({ ok: false, reason: 'reserved' })
    }
  })

  it('制御文字・ゼロ幅文字・そっくり文字で予約語判定を回避できない', () => {
    const evil = [
      `ad${ZWSP}min`,
      `a${ZWJ}d${ZWNJ}min`,
      `${BOM}admin`,
      `運${ZWSP}営`,
      `${RLO}admin${PDF}`,
      'a-d-m-i-n',
      'аdmin',
    ]
    for (const raw of evil) {
      expect(validateDisplayName(raw)).toEqual({ ok: false, reason: 'reserved' })
    }
  })
})
