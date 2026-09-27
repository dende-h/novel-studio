import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import {
  composeScriptSheet,
  countScriptSheets,
  layoutScriptBlocks,
  normalizeScriptText,
  paginate,
  type SheetLine,
  toFullWidth,
  wrapLine,
} from './layout'

const S = '　'
const lines = (body: string) => layoutScriptBlocks(parseEpisodeBody(body))
const texts = (body: string) => lines(body).map((l) => l.text)

describe('wrapLine（折り返しと禁則）', () => {
  it('cols ごとに折り返し、2行目以降は restIndent で字下げる', () => {
    expect(wrapLine('あいうえおかきくけこさしすせそ', 5, 0, 1)).toEqual([
      'あいうえお',
      `${S}かきくけ`,
      `${S}こさしす`,
      `${S}せそ`,
    ])
  })
  it('句読点は行末にぶら下げ、閉じ括弧は前の字ごと追い出す', () => {
    expect(wrapLine('あいうえお。かき', 5, 0, 0)).toEqual(['あいうえお。', 'かき'])
    expect(wrapLine('あいうえお」かき', 5, 0, 0)).toEqual(['あいうえ', 'お」かき'])
    // 行末禁則：開き括弧は次の行へ送る。
    expect(wrapLine('あいうえ「かき」', 5, 0, 0)).toEqual(['あいうえ', '「かき」'])
  })
  it('空文字は字下げだけの行になる', () => {
    expect(wrapLine('', 20, 3, 3)).toEqual([S.repeat(3)])
  })
})

describe('toFullWidth / normalizeScriptText', () => {
  it('半角英数記号と空白を全角に揃える', () => {
    expect(toFullWidth('No.1 (A)')).toBe('Ｎｏ．１　（Ａ）')
  })
  it('感嘆符・疑問符の後ろは1マス空ける。閉じ括弧・行末・既に空いている所は空けない', () => {
    expect(normalizeScriptText('えっ！なに？　ほんと？」')).toBe('えっ！　なに？　ほんと？」')
    expect(normalizeScriptText('本当か!?わからない')).toBe('本当か！？　わからない')
    expect(normalizeScriptText('ユイ「まさか！」')).toBe('ユイ「まさか！」')
  })
})

describe('layoutScriptBlocks（本文の流し込み）', () => {
  it('ト書きは3字下げ（打ってあってもなくても同じ）、柱は行頭で前に空行、セリフは話者の後ろに揃える', () => {
    expect(texts('○公園（夕方）\n風が吹く\n　　　風が吹く\nユイ（声）「こんにちは」')).toEqual([
      '○公園（夕方）',
      `${S}${S}${S}風が吹く`,
      `${S}${S}${S}風が吹く`,
      'ユイ（声）「こんにちは」',
    ])
  })
  it('柱の前の空行は打ってあっても1つに畳み、連続する空行も1つにする', () => {
    expect(texts('風\n\n\n○家\n\n\n雨')).toEqual(['　　　風', '', '○家', '', '　　　雨'])
    expect(texts('風\n○家')).toEqual(['　　　風', '', '○家'])
  })
  it('場面転換は ×　　×　　× を中央に置き、前後に空行を1つずつ', () => {
    expect(texts('風\n***\n雨')).toEqual([
      '　　　風',
      '',
      `${S.repeat(6)}×　　×　　×`,
      '',
      '　　　雨',
    ])
  })
  it('セリフの2行目以降は1字下げ（話者の有無によらない）', () => {
    const body = `ユイ「${'あ'.repeat(30)}」\n「${'い'.repeat(25)}」`
    const out = texts(body)
    expect(out[0]).toBe(`ユイ「${'あ'.repeat(17)}`)
    expect(out[1]).toBe(`${S}${'あ'.repeat(13)}」`)
    expect(out[2]).toBe(`「${'い'.repeat(19)}`)
    expect(out[3]).toBe(`${S}${'い'.repeat(6)}」`)
  })
  it('！？の後ろの1マスは本文に打ってあってもなくても同じ', () => {
    expect(texts('ユイ「え！なに？」')).toEqual(['ユイ「え！　なに？」'])
    expect(texts('ユイ「え！　なに？」')).toEqual(['ユイ「え！　なに？」'])
  })
  it('ト書きの途中に鉤括弧があっても、字下げされていればト書きとして3字下げのまま', () => {
    expect(texts('　看板に「立入禁止」とある')).toEqual([`${S.repeat(3)}看板に「立入禁止」とある`])
  })
  it('ルビは親文字だけ、傍点と用語引用は素の文字になる', () => {
    expect(texts('｜漢字《かんじ》が《《光る》》[[ユイ]]')).toEqual([
      `${S.repeat(3)}漢字が光るユイ`,
    ])
  })
  it('半角は全角にして1マス1文字を守る', () => {
    expect(texts('No.1')).toEqual([`${S.repeat(3)}Ｎｏ．１`])
  })
})

describe('paginate（頁割り）', () => {
  const line = (kind: SheetLine['kind'], text = 'x'): SheetLine => ({ kind, text })
  it('rows ごとに頁を切り、頁頭の空行は捨てる', () => {
    const src = [
      line('direction'),
      line('blank', ''),
      line('direction'),
      line('blank', ''),
      line('direction'),
    ]
    const pages = paginate(src, { cols: 20, rows: 2 })
    expect(pages.map((p) => p.lines.map((l) => l.kind))).toEqual([
      ['direction', 'blank'],
      ['direction', 'blank'],
      ['direction'],
    ])
    expect(pages.map((p) => p.number)).toEqual([1, 2, 3])
  })
  it('numberFrom より前の行だけの頁にはノンブルを振らず、本文の最初の頁を 1 にする', () => {
    const src = [
      line('title'),
      line('pageBreak', ''),
      line('direction'),
      line('pageBreak', ''),
      line('direction'),
    ]
    const pages = paginate(src, { cols: 20, rows: 20 }, 2)
    expect(pages.map((p) => p.number)).toEqual([undefined, 1, 2])
  })
  it('柱が頁の最終行に来るときは、直前の空行ごと次頁へ送る', () => {
    const src = [line('direction'), line('blank', ''), line('slug'), line('direction')]
    const pages = paginate(src, { cols: 20, rows: 3 })
    expect(pages.map((p) => p.lines.map((l) => l.kind))).toEqual([
      ['direction'],
      ['slug', 'direction'],
    ])
  })
  it('pageBreak で強制改頁し、空の頁は作らない', () => {
    const src = [
      line('pageBreak', ''),
      line('direction'),
      line('pageBreak', ''),
      line('pageBreak', ''),
      line('direction'),
    ]
    expect(paginate(src, { cols: 20, rows: 20 })).toHaveLength(2)
  })
})

describe('composeScriptSheet（提出用の綴じ方）', () => {
  const ep = (title: string, body: string) => ({ title, blocks: parseEpisodeBody(body) })
  it('表紙・登場人物表・梗概・本文の順に頁を作り、ノンブルは本文から 1 で振る', () => {
    const pages = composeScriptSheet({
      title: '月と剣',
      author: '著者',
      cast: [{ name: 'ユイ', note: '主人公。十七歳。' }, { name: 'ケン' }],
      synopsis: '一行目。\n\n三行目。',
      episodes: [ep('', '○公園\n風')],
    })
    expect(pages).toHaveLength(4)
    expect(pages.map((p) => p.number)).toEqual([undefined, undefined, undefined, 1])
    const cover = pages[0]?.lines.filter((l) => l.kind === 'title').map((l) => l.text.trim())
    expect(cover).toEqual(['月と剣', '著者'])
    expect(pages[1]?.lines[0]).toEqual({ kind: 'heading', text: '登場人物表' })
    expect(pages[1]?.lines.map((l) => l.text)).toContain('ユイ　主人公。十七歳。')
    expect(pages[1]?.lines.map((l) => l.text)).toContain('ケン')
    expect(pages[2]?.lines[0]).toEqual({ kind: 'heading', text: 'あらすじ' })
    expect(pages[2]?.lines.map((l) => l.text)).toEqual([
      'あらすじ',
      '',
      '　一行目。',
      '',
      '　三行目。',
    ])
    expect(pages[3]?.lines.map((l) => l.text)).toEqual(['○公園', '　　　風'])
  })
  it('表紙などを外せる。話が複数なら話ごとに改頁して題名を見出しに置く', () => {
    const pages = composeScriptSheet(
      { title: 'T', episodes: [ep('第一話', '風'), ep('第二話', '雨')] },
      { cover: false, cast: false, synopsis: false },
    )
    expect(pages).toHaveLength(2)
    expect(pages[0]?.lines.map((l) => l.text)).toEqual(['第一話', '', '　　　風'])
    expect(pages[1]?.lines.map((l) => l.text)).toEqual(['第二話', '', '　　　雨'])
  })
  it('登場人物やあらすじが空なら頁を作らない', () => {
    const pages = composeScriptSheet({
      title: 'T',
      cast: [],
      synopsis: '  ',
      episodes: [ep('', '風')],
    })
    expect(pages).toHaveLength(2)
  })
})

describe('countScriptSheets', () => {
  it('本編だけの枚数を 20×20 で数える', () => {
    const body = Array.from({ length: 45 }, (_, i) => `行${i}`).join('\n')
    expect(countScriptSheets(parseEpisodeBody(body))).toBe(3)
  })
})
