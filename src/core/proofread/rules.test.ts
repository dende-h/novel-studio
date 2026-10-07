import { describe, expect, it } from 'vitest'
import { checkLine } from './rules'

const codes = (text: string) => checkLine(text).map((h) => h.code)

describe('indent（字下げ）', () => {
  it('行頭が全角空白・開き括弧・記法の記号なら通す', () => {
    for (const t of [
      '　夜の校舎に',
      '「はい」',
      '『本』',
      '（補足）',
      '……そう',
      '――そう',
      '＊',
      '｜宮森《みやもり》',
    ]) {
      expect(codes(t), t).not.toContain('indent')
    }
  })
  it('行頭が本文の文字なら候補にする', () => {
    expect(codes('彼は言った。')).toContain('indent')
    expect(codes('Aは言った。')).toContain('indent')
  })
  it('空行・空白だけの行は何も返さない', () => {
    expect(checkLine('')).toEqual([])
    expect(checkLine('　')).toEqual([])
    expect(checkLine('  ')).toEqual([])
  })
})

describe('punct-before-close（閉じ括弧の前の句読点）', () => {
  it('「。」「、』「。）を候補にする', () => {
    expect(codes('「もう帰ろうよ。」')).toContain('punct-before-close')
    expect(codes('『待って、』')).toContain('punct-before-close')
    expect(codes('（そう。）')).toContain('punct-before-close')
  })
  it('句読点が無ければ通す', () => {
    expect(codes('「もう帰ろうよ」')).not.toContain('punct-before-close')
  })
})

describe('space-after-exclamation（！？の後の空白）', () => {
  it('直後が本文の文字なら候補にする', () => {
    expect(codes('「待って！すぐ終わるから」')).toContain('space-after-exclamation')
    expect(codes('「なぜ？それは」')).toContain('space-after-exclamation')
  })
  it('空白・！？・三点リーダー・ダッシュ・閉じ括弧・行末なら通す', () => {
    for (const t of [
      '「待って！　すぐ終わるから」',
      '「待って！ すぐ」',
      '「待って！」',
      '　待って！',
      '「！？」',
      '「待って！……」',
      '「嘘だ！――」',
      '「待って！』',
    ]) {
      expect(codes(t), t).not.toContain('space-after-exclamation')
    }
  })
})

describe('leader-odd（三点リーダー・ダッシュ）', () => {
  it('三点リーダーの奇数連続', () => {
    const hits = checkLine('　揺れて…、足音が')
    expect(hits.map((h) => h.code)).toContain('leader-odd')
    expect(hits.find((h) => h.code === 'leader-odd')?.message).toContain('三点リーダー')
    expect(codes('「………なん…だと…」')).toContain('leader-odd')
  })
  it('偶数なら通す', () => {
    expect(codes('「……偶数個なら……大丈夫…………」')).not.toContain('leader-odd')
  })
  it('ダッシュの奇数連続', () => {
    const hits = checkLine('「一体いつから―――奇数個でも」')
    expect(hits.find((h) => h.code === 'leader-odd')?.message).toContain('ダッシュ')
    expect(codes('「偶数なら――――大丈夫」')).not.toContain('leader-odd')
  })
  it('中黒の連続は三点リーダーの誤用として候補にする。単語の区切りの中黒は通す', () => {
    const hits = checkLine('「ちゃんと・・・三点リーダーを」')
    expect(hits.find((h) => h.code === 'leader-odd')?.message).toContain('中黒')
    expect(codes('「単語の・区切りなら・大丈夫」')).not.toContain('leader-odd')
  })
  it('1 行に 1 件まで', () => {
    expect(codes('…と―と・・').filter((c) => c === 'leader-odd')).toHaveLength(1)
  })
})

describe('halfwidth-punct（半角の約物）', () => {
  it('和文に隣接する半角 !? と ,. を候補にする', () => {
    const ex = checkLine('「待って!すぐ終わるから」')
    expect(ex.find((h) => h.code === 'halfwidth-punct')?.message).toContain('感嘆符')
    const pt = checkLine('　夜の校舎に,私は')
    expect(pt.find((h) => h.code === 'halfwidth-punct')?.message).toContain('句読点')
    expect(codes('　待って...')).toContain('halfwidth-punct')
  })
  it('英数字の並び（URL・英文）には反応しない', () => {
    expect(codes('　https://example.com/a.b?c=1 を開いた')).not.toContain('halfwidth-punct')
    expect(codes('　Hello, world!')).not.toContain('halfwidth-punct')
  })
})

describe('successive-word（同じ語の連続）', () => {
  it('助詞 1 文字の重複を候補にし、当たった文字列をメッセージに添える', () => {
    const hits = checkLine('　非常口の緑の光がが揺れて')
    const hit = hits.find((h) => h.code === 'successive-word')
    expect(hit?.message).toBe(
      '同じ語が続いています（がが）。打ち間違いでなければ、そのままで構いません。',
    )
    expect(codes('　本をを読む')).toContain('successive-word')
  })
  it('漢字を含む 2〜6 文字の繰り返しを候補にする', () => {
    expect(
      checkLine('　彼は言った言った').find((h) => h.code === 'successive-word')?.message,
    ).toContain('言った言った')
    expect(codes('　今日は今日はと書いた')).toContain('successive-word')
  })
  it('常用語・畳語・擬音には当たらない', () => {
    for (const t of [
      '　ものの、彼は',
      '　ひとと目が合った',
      '　なにに使うのか',
      '　ここまでで良い',
      '　彼とともに歩いた',
      '　ちょっとと言われた',
      '　どきどき',
      '　どきどき胸が高鳴る',
      '　ますます強く',
      '　きらきら光る',
      '　そろそろ帰る',
      '　ところどころ',
      '　母はははと笑った',
    ]) {
      expect(codes(t), t).not.toContain('successive-word')
    }
  })
})

it('1 行に複数の項目が当たれば項目ごとに 1 件ずつ返す', () => {
  const hits = checkLine('彼は「待って!」と言った言った。')
  expect(hits.map((h) => h.code)).toEqual(['indent', 'halfwidth-punct', 'successive-word'])
})
