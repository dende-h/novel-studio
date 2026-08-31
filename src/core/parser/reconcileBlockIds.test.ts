import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from './parseNotation'
import { reconcileBlockIds } from './reconcileBlockIds'

const ids = (blocks: { id: string }[]) => blocks.map((b) => b.id)

describe('reconcileBlockIds（保存をまたぐ id の引き継ぎ）', () => {
  it('内容が変わらなければ id 列もそのまま（保存の無変化判定を壊さない）', () => {
    const prev = parseEpisodeBody('一行目。\n\n「二行目」')
    const next = parseEpisodeBody('一行目。\n\n「二行目」')
    expect(reconcileBlockIds(prev, next)).toEqual(prev)
  })

  it('行を挿入しても、変わっていない行は旧 id を保つ（新行だけ新 id）', () => {
    const prev = parseEpisodeBody('一行目。\n二行目。\n三行目。')
    const next = parseEpisodeBody('一行目。\n割り込み。\n二行目。\n三行目。')
    const out = reconcileBlockIds(prev, next)
    expect(out[0]?.id).toBe('b1')
    expect(out[2]?.id).toBe('b2') // 位置は3行目へずれたが内容一致で引き継ぐ
    expect(out[3]?.id).toBe('b3')
    // 新行はパーサの id が旧 id と衝突するので振り直される
    expect(['b1', 'b2', 'b3']).not.toContain(out[1]?.id)
  })

  it('行を削除しても残った行の id は変わらず、消えた id は再利用されない', () => {
    const prev = parseEpisodeBody('一。\n二。\n三。')
    const next = parseEpisodeBody('一。\n三。')
    const out = reconcileBlockIds(prev, next)
    expect(ids(out)).toEqual(['b1', 'b3'])
  })

  it('1行だけ書き換えた行は位置対応で旧 id を引き継ぐ（演出が外れない）', () => {
    const prev = parseEpisodeBody('一行目。\n「セリフ」\n三行目。')
    const next = parseEpisodeBody('一行目。\n「セリフを直した」\n三行目。')
    const out = reconcileBlockIds(prev, next)
    expect(ids(out)).toEqual(['b1', 'b2', 'b3'])
  })

  it('行の移動（同一内容）には id が付いて行く', () => {
    const prev = parseEpisodeBody('あ。\nい。\nう。')
    const next = parseEpisodeBody('い。\nう。\nあ。')
    const out = reconcileBlockIds(prev, next)
    expect(ids(out)).toEqual(['b2', 'b3', 'b1'])
  })

  it('同一内容の行（空行など）は出現順で安定に対応する', () => {
    const prev = parseEpisodeBody('あ。\n\nい。\n\nう。')
    const next = parseEpisodeBody('あ。\n\nい。\n\nう。')
    expect(reconcileBlockIds(prev, next)).toEqual(prev)
  })

  it('prev が空（新規の話）ならパーサの id をそのまま使う', () => {
    const next = parseEpisodeBody('一。\n二。')
    expect(ids(reconcileBlockIds([], next))).toEqual(['b1', 'b2'])
  })

  it('出力の id は常に一意（genId が固定値でも衝突しない）', () => {
    const prev = parseEpisodeBody('一。\n二。\n三。')
    // 3行とも書き換え + 2行追加 → パス2で3つ引き継ぎ、残り2行は新 id
    const next = parseEpisodeBody('壱。\n弐。\n参。\n四。\n五。')
    const out = reconcileBlockIds(prev, next, () => 'x')
    expect(new Set(ids(out)).size).toBe(out.length)
    expect(ids(out).slice(0, 3)).toEqual(['b1', 'b2', 'b3'])
  })

  it('入力の prev / next を変更しない', () => {
    const prev = parseEpisodeBody('一。\n二。')
    const next = parseEpisodeBody('二。\n一。')
    const beforePrev = JSON.stringify(prev)
    const beforeNext = JSON.stringify(next)
    reconcileBlockIds(prev, next)
    expect(JSON.stringify(prev)).toBe(beforePrev)
    expect(JSON.stringify(next)).toBe(beforeNext)
  })

  it('ルビ・参照を含む行も内容一致で引き継がれる', () => {
    const prev = parseEpisodeBody('｜灯《あかり》は笑う。\n[[灯]]が言った。')
    const next = parseEpisodeBody('前置き。\n｜灯《あかり》は笑う。\n[[灯]]が言った。')
    const out = reconcileBlockIds(prev, next)
    expect(out[1]?.id).toBe('b1')
    expect(out[2]?.id).toBe('b2')
  })
})
