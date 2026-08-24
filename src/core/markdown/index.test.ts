import { describe, expect, it } from 'vitest'
import { markdownToHtml, stripMarkdown } from './index'

/**
 * プレビュー用マークダウンの固定。関心は
 * - 従来のプレビュー（1 行 = 1 段落・空行保持・[[用語]] リンク）を壊さないこと
 * - 見出し 3 段・リスト 3 階層・表・引用・区切り線・強調が仕様どおり HTML になること
 * - 本文記法（ルビ・傍点・参照）がマークダウンの中でも生きること
 * - エスケープが全経路で効くこと（生 HTML を通さない）
 */

describe('markdownToHtml（従来プレビューとの互換）', () => {
  it('ただの文は 1 行 = 1 段落（従来の NotationField プレビューと同形）', () => {
    expect(markdownToHtml('一行目\n二行目')).toBe('<p>一行目</p><p>二行目</p>')
  })

  it('空行は空段落として保持する', () => {
    expect(markdownToHtml('前\n\n後')).toBe('<p>前</p><p class="blank"></p><p>後</p>')
  })

  it('[[用語]] は解決済みならリンク描画・未解決は色分けクラス（blocksToHtml と同じ）', () => {
    const resolved = new Set(['ユキ'])
    expect(markdownToHtml('[[ユキ]]と[[謎の男]]', resolved)).toBe(
      '<p><span class="ref" data-ref-name="ユキ">ユキ</span>と' +
        '<span class="ref ref--unresolved" data-ref-name="謎の男">謎の男</span></p>',
    )
  })

  it('resolvedNames 未指定なら参照はプレーンテキストへ degrade する', () => {
    expect(markdownToHtml('[[ユキ]]が来た')).toBe('<p>ユキが来た</p>')
  })

  it('ルビ・傍点は従来どおり描画される', () => {
    expect(markdownToHtml('｜言葉《ことば》と《《強い》》')).toBe(
      '<p><ruby>言葉<rp>（</rp><rt>ことば</rt><rp>）</rp></ruby>と<em class="dots">強い</em></p>',
    )
  })

  it('HTML はエスケープされる（生の HTML を通さない）。数字の縦中横 span も従来どおり', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(<span class="tcy">1</span>)&lt;/script&gt;</p>',
    )
  })
})

describe('markdownToHtml（見出し）', () => {
  it('# ## ### が h1〜h3 になる', () => {
    expect(markdownToHtml('# 一\n## 二\n### 三')).toBe('<h1>一</h1><h2>二</h2><h3>三</h3>')
  })

  it('#### 以上・# 直後に空白が無い行は見出しにしない', () => {
    expect(markdownToHtml('#### 四')).toBe('<p>#### 四</p>')
    expect(markdownToHtml('#タグ')).toBe('<p>#タグ</p>')
  })

  it('見出しの中でも強調・参照が使える', () => {
    expect(markdownToHtml('## **山場**の[[ユキ]]', new Set(['ユキ']))).toBe(
      '<h2><strong>山場</strong>の<span class="ref" data-ref-name="ユキ">ユキ</span></h2>',
    )
  })
})

describe('markdownToHtml（強調）', () => {
  it('**強調** が strong になる', () => {
    expect(markdownToHtml('これは**大事**です')).toBe('<p>これは<strong>大事</strong>です</p>')
  })

  it('対にならない ** はただの文字', () => {
    expect(markdownToHtml('**開きっぱなし')).toBe('<p>**開きっぱなし</p>')
    expect(markdownToHtml('空の****もそのまま')).toBe('<p>空の****もそのまま</p>')
  })

  it('強調の中の記法（ルビ・参照）も生きる', () => {
    expect(markdownToHtml('**｜要《かなめ》**')).toBe(
      '<p><strong><ruby>要<rp>（</rp><rt>かなめ</rt><rp>）</rp></ruby></strong></p>',
    )
  })
})

describe('markdownToHtml（リスト）', () => {
  it('- の連続が 1 つの ul になる', () => {
    expect(markdownToHtml('- あ\n- い')).toBe('<ul><li>あ</li><li>い</li></ul>')
  })

  it('1. の連続が ol になり、開始番号を引き継ぐ', () => {
    expect(markdownToHtml('1. あ\n2. い')).toBe('<ol><li>あ</li><li>い</li></ol>')
    expect(markdownToHtml('3. あ\n4. い')).toBe('<ol start="3"><li>あ</li><li>い</li></ol>')
  })

  it('字下げ（スペース 2 つ）で入れ子になり、3 階層までで頭打ち', () => {
    expect(markdownToHtml('- 親\n  - 子\n    - 孫\n      - ひ孫')).toBe(
      '<ul><li>親<ul><li>子<ul><li>孫</li><li>ひ孫</li></ul></li></ul></li></ul>',
    )
  })

  it('タブ・全角空白の字下げも 1 段として扱う', () => {
    expect(markdownToHtml('- 親\n\t- タブの子\n　- 全角の子')).toBe(
      '<ul><li>親<ul><li>タブの子</li><li>全角の子</li></ul></li></ul>',
    )
  })

  it('箇条書きと番号付きは同じ階層でも別の列になる', () => {
    expect(markdownToHtml('- あ\n1. い')).toBe('<ul><li>あ</li></ul><ol><li>い</li></ol>')
  })

  it('番号付きの子に箇条書きを混ぜられる', () => {
    expect(markdownToHtml('1. 親\n  - 子')).toBe('<ol><li>親<ul><li>子</li></ul></li></ol>')
  })

  it('marker 直後に空白が無い行はリストにしない（ハイフン書き・小数の誤爆防止）', () => {
    expect(markdownToHtml('-これはリストではない')).toBe('<p>-これはリストではない</p>')
    expect(markdownToHtml('1.5倍にする')).toBe(
      '<p><span class="tcy">1</span>.<span class="tcy">5</span>倍にする</p>',
    )
  })

  it('リスト項目の中でも参照が生きる', () => {
    expect(markdownToHtml('- [[ユキ]]登場', new Set(['ユキ']))).toBe(
      '<ul><li><span class="ref" data-ref-name="ユキ">ユキ</span>登場</li></ul>',
    )
  })
})

describe('markdownToHtml（区切り線・引用）', () => {
  it('--- が hr になる（4 本以上・前後空白も許す）', () => {
    expect(markdownToHtml('---')).toBe('<hr>')
    expect(markdownToHtml(' ----- ')).toBe('<hr>')
    expect(markdownToHtml('--')).toBe('<p>--</p>')
  })

  it('> の連続が 1 つの blockquote になる', () => {
    expect(markdownToHtml('> 一行目\n> 二行目')).toBe(
      '<blockquote><p>一行目</p><p>二行目</p></blockquote>',
    )
  })

  it('引用の中でも見出しやリストが使える', () => {
    expect(markdownToHtml('> ## 引用見出し\n> - 引用リスト')).toBe(
      '<blockquote><h2>引用見出し</h2><ul><li>引用リスト</li></ul></blockquote>',
    )
  })

  it('> > で引用が入れ子になる', () => {
    expect(markdownToHtml('> 外\n> > 内')).toBe(
      '<blockquote><p>外</p><blockquote><p>内</p></blockquote></blockquote>',
    )
  })
})

describe('markdownToHtml（表）', () => {
  it('2 行目が区切り行なら 1 行目が見出しになる', () => {
    expect(markdownToHtml('| 名前 | 役 |\n| --- | --- |\n| ユキ | 主人公 |')).toBe(
      '<div class="md-table"><table>' +
        '<thead><tr><th>名前</th><th>役</th></tr></thead>' +
        '<tbody><tr><td>ユキ</td><td>主人公</td></tr></tbody>' +
        '</table></div>',
    )
  })

  it('区切り行が無ければ全行を本体として描く', () => {
    expect(markdownToHtml('| a | b |\n| c | d |')).toBe(
      '<div class="md-table"><table><tbody>' +
        '<tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr>' +
        '</tbody></table></div>',
    )
  })

  it(':--- / :---: / ---: で列が揃う', () => {
    expect(markdownToHtml('| a | b | c |\n| :-- | :-: | --: |\n| い | ろ | は |')).toBe(
      '<div class="md-table"><table>' +
        '<thead><tr><th>a</th><th style="text-align:center">b</th><th style="text-align:right">c</th></tr></thead>' +
        '<tbody><tr><td>い</td><td style="text-align:center">ろ</td><td style="text-align:right">は</td></tr></tbody>' +
        '</table></div>',
    )
  })

  it('セルの中でも参照・強調が生きる', () => {
    expect(markdownToHtml('| [[ユキ]] | **主役** |\n| a | b |', new Set(['ユキ']))).toBe(
      '<div class="md-table"><table><tbody>' +
        '<tr><td><span class="ref" data-ref-name="ユキ">ユキ</span></td><td><strong>主役</strong></td></tr>' +
        '<tr><td>a</td><td>b</td></tr>' +
        '</tbody></table></div>',
    )
  })

  it('| で始まる単独行は表にしない（ルビ記法 |親文字《よみ》 の保護）', () => {
    expect(markdownToHtml('|言葉《ことば》を継ぐ')).toBe(
      '<p><ruby>言葉<rp>（</rp><rt>ことば</rt><rp>）</rp></ruby>を継ぐ</p>',
    )
  })
})

describe('stripMarkdown（読むだけの場所の表示用）', () => {
  it('見出し・リスト・引用・強調の記号を剥がして中身を残す', () => {
    expect(stripMarkdown('## 山場\n- **決戦**\n> 引用')).toBe('山場\n決戦\n引用')
  })

  it('区切り線・表の区切り行は落とし、セルは空白で繋ぐ', () => {
    expect(stripMarkdown('---\n| 名前 | 役 |\n| --- | --- |\n| ユキ | 主人公 |')).toBe(
      '\n名前 役\n\nユキ 主人公',
    )
  })

  it('[[用語]]・ルビはそのまま残す（従来どおり blocksToPlainText 側が剥がす）', () => {
    expect(stripMarkdown('- [[ユキ]]と｜言葉《ことば》')).toBe('[[ユキ]]と｜言葉《ことば》')
  })

  it('マークダウンを含まない文はそのまま', () => {
    expect(stripMarkdown('ただの文。\n二行目')).toBe('ただの文。\n二行目')
  })
})
