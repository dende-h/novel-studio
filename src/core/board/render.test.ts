import { markdownToHtml } from '../markdown'
import { extractUrls } from './link'
import { boardBodyToHtml, boardBodyToPlain, boardInlineHtml, escapeHtml } from './render'

/**
 * 掲示板の本文描画の契約を固定する（設計書 09-board §7-10）。
 * 関心は 4 つ。
 * - 生の HTML が一切通らないこと（赤の他人の文字列を出す場所なので、ここが最優先）
 * - 小説向けの記法（[[用語]]・ルビ・傍点・縦中横）が**効かない**こと
 * - 裸の URL が `rel="nofollow ugc noopener noreferrer"` 付きのリンクになり、
 *   http(s) 以外はリンクにならないこと
 * - ブロック（見出し・箇条書き・引用・表）は markdownToHtml のものが使い回せていること
 */

const REL = 'nofollow ugc noopener noreferrer'

describe('escapeHtml', () => {
  it('& < > " \' をすべて実体参照にする', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('& を先に置換するので二重エスケープにならない', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})

describe('boardInlineHtml（生 HTML を通さない）', () => {
  it('<script> はタグにならない', () => {
    expect(boardInlineHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('<img onerror> はタグにならない', () => {
    expect(boardInlineHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    )
  })

  it('引用符は属性を抜け出せない形にエスケープする', () => {
    expect(boardInlineHtml(`"二重" と '一重'`)).toBe('&quot;二重&quot; と &#39;一重&#39;')
  })

  it('本文のどこにも生の < > は残らない（見出し・リスト・引用・表を通しても同じ）', () => {
    const body = [
      '# <script>x</script>',
      '- <img onerror=1>',
      '> <b>強い</b>',
      '| <i>a</i> | b |',
      '| --- | --- |',
      '| c | <u>d</u> |',
    ].join('\n')
    const html = boardBodyToHtml(body)
    for (const tag of ['<script', '<img', '<b>', '<i>', '<u>']) {
      expect(html).not.toContain(tag)
    }
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;u&gt;d&lt;/u&gt;')
  })
})

describe('boardInlineHtml（小説の記法は効かない）', () => {
  it('[[用語]] はリンクにならず、書いたままの文字で出る', () => {
    expect(boardInlineHtml('[[ユキ]]が来た')).toBe('[[ユキ]]が来た')
    expect(boardInlineHtml('[[ユキ]]')).not.toContain('<span')
  })

  it('ルビ（|親《よみ》）は解釈せずそのまま出す', () => {
    const html = boardInlineHtml('|漢字《かんじ》と｜和布蕪《めかぶ》')
    expect(html).toBe('|漢字《かんじ》と｜和布蕪《めかぶ》')
    expect(html).not.toContain('<ruby')
  })

  it('傍点は解釈しない', () => {
    const html = boardInlineHtml('《《ここ》》が大事')
    expect(html).not.toContain('<span')
    expect(html).toBe('《《ここ》》が大事')
  })

  it('数字に縦中横の span を挿さない（URL の中の数字も割らない）', () => {
    expect(boardInlineHtml('12月に3件')).toBe('12月に3件')
    expect(boardInlineHtml('12月に3件')).not.toContain('tcy')
    expect(boardBodyToHtml('https://example.com/?b=1')).not.toContain('tcy')
  })
})

describe('boardInlineHtml（強調）', () => {
  it('**強調** は <strong> になる', () => {
    expect(boardInlineHtml('これは**大事**です')).toBe('これは<strong>大事</strong>です')
  })

  it('対にならない ** はただの文字として残す', () => {
    expect(boardInlineHtml('**閉じない')).toBe('**閉じない')
    expect(boardInlineHtml('****')).toBe('****')
  })

  it('強調の中身もエスケープされる', () => {
    expect(boardInlineHtml('**<b>**')).toBe('<strong>&lt;b&gt;</strong>')
  })

  it('強調の中の URL もリンクになる', () => {
    expect(boardInlineHtml('**見て https://example.com/a です**')).toBe(
      `<strong>見て <a href="https://example.com/a" target="_blank" rel="${REL}">https://example.com/a</a> です</strong>`,
    )
  })

  it('URL に貼りついた ** は URL の一部になる（extractUrls と食い違わせない）', () => {
    // `*` は URL の文字集合の内側なので `**url**` の閉じ ** まで URL に入る。
    // ここで強調を優先すると、リンクの href と link.ts が OGP を取りに行く URL がずれる。
    const text = '**https://example.com/**'
    expect(extractUrls(text)).toEqual(['https://example.com/**'])
    expect(boardInlineHtml(text)).toBe(
      `**<a href="https://example.com/**" target="_blank" rel="${REL}">https://example.com/**</a>`,
    )
  })

  it('URL の中の ** は強調の記号にしない（リンクが割れない）', () => {
    const html = boardInlineHtml('https://example.com/a**b')
    expect(html).toBe(
      `<a href="https://example.com/a**b" target="_blank" rel="${REL}">https://example.com/a**b</a>`,
    )
    expect(html).not.toContain('<strong>')
  })
})

describe('boardInlineHtml（自動リンク）', () => {
  it('裸の URL は rel="nofollow ugc noopener noreferrer" 付きの別タブリンクになる', () => {
    expect(boardInlineHtml('見て https://example.com/a?b=1 ね')).toBe(
      `見て <a href="https://example.com/a?b=1" target="_blank" rel="${REL}">https://example.com/a?b=1</a> ね`,
    )
  })

  it('http: もリンクになる', () => {
    expect(boardInlineHtml('http://example.com/')).toContain('href="http://example.com/"')
  })

  it('javascript: はリンクにならない（素のテキスト）', () => {
    const html = boardInlineHtml('javascript:alert(1)')
    expect(html).toBe('javascript:alert(1)')
    expect(html).not.toContain('<a ')
  })

  it('data: URL はリンクにならない', () => {
    const html = boardInlineHtml('data:text/html,<script>alert(1)</script>')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<script')
  })

  it('vbscript: はリンクにならない', () => {
    expect(boardInlineHtml('vbscript:msgbox(1)')).not.toContain('<a ')
  })

  it('URL の直後に " を混ぜても属性を抜け出せない', () => {
    const html = boardInlineHtml('https://x.example/"onmouseover="alert(1)')
    // `"` は URL の文字集合の外なので、そこで URL が切れて残りはただの文字になる。
    expect(html).toBe(
      `<a href="https://x.example/" target="_blank" rel="${REL}">https://x.example/</a>` +
        '&quot;onmouseover=&quot;alert(1)',
    )
    expect(html).not.toContain('onmouseover="alert')
  })

  it('URL に < を混ぜても属性を抜け出せない', () => {
    const html = boardInlineHtml('https://x.example/a<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it("URL に ' を含むときは href が実体参照になる", () => {
    const html = boardInlineHtml("https://x.example/a'b")
    expect(html).toBe(
      `<a href="https://x.example/a&#39;b" target="_blank" rel="${REL}">https://x.example/a&#39;b</a>`,
    )
  })

  it('クエリの & は href の中でも実体参照になる', () => {
    expect(boardInlineHtml('https://x.example/?a=1&b=2')).toBe(
      `<a href="https://x.example/?a=1&amp;b=2" target="_blank" rel="${REL}">https://x.example/?a=1&amp;b=2</a>`,
    )
  })

  it('文末の句読点や閉じ括弧は URL に巻き込まない', () => {
    expect(boardInlineHtml('ここ https://example.com/a です。')).toContain(
      '>https://example.com/a</a> です。',
    )
    expect(boardInlineHtml('(https://example.com/a)')).toContain('>https://example.com/a</a>)')
  })

  it('リンクにする文字列は extractUrls（link.ts）の結果と一致する', () => {
    const samples = [
      'ここ https://example.com/a です。',
      '(https://example.com/a) と https://ja.wikipedia.org/wiki/A_(B)',
      'https://example.com/?a=1&b=2 と http://example.com/b',
      'https:// だけ',
      '日本語https://example.com/xの直後',
      'https://example.com/a**b**c',
    ]
    for (const sample of samples) {
      const html = boardInlineHtml(sample)
      const linked = [...html.matchAll(/<a href="([^"]*)"/g)].map((m) =>
        (m[1] as string)
          .replaceAll('&#39;', "'")
          .replaceAll('&quot;', '"')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&amp;', '&'),
      )
      expect(linked).toEqual(extractUrls(sample))
    }
  })
})

describe('boardBodyToHtml（ブロック層の使い回し）', () => {
  it('見出しは h1〜h3 になる', () => {
    expect(boardBodyToHtml('# 大\n## 中\n### 小')).toBe('<h1>大</h1><h2>中</h2><h3>小</h3>')
  })

  it('箇条書きは ul/li になる', () => {
    expect(boardBodyToHtml('- あ\n- い')).toBe('<ul><li>あ</li><li>い</li></ul>')
  })

  it('番号付きは ol/li になる', () => {
    expect(boardBodyToHtml('1. あ\n2. い')).toBe('<ol><li>あ</li><li>い</li></ol>')
  })

  it('引用は blockquote になり、中でも行内の規則が効く', () => {
    expect(boardBodyToHtml('> **強い**')).toBe(
      '<blockquote><p><strong>強い</strong></p></blockquote>',
    )
  })

  it('区切り線は hr になる', () => {
    expect(boardBodyToHtml('---')).toBe('<hr>')
  })

  it('表は thead/tbody つきで描ける', () => {
    expect(boardBodyToHtml('| 名 | 数 |\n| --- | ---: |\n| あ | 1 |')).toBe(
      '<div class="md-table"><table><thead><tr><th>名</th>' +
        '<th style="text-align:right">数</th></tr></thead>' +
        '<tbody><tr><td>あ</td><td style="text-align:right">1</td></tr></tbody></table></div>',
    )
  })

  it('ただの行は 1 行 = 1 段落、空行も保持する', () => {
    expect(boardBodyToHtml('前\n\n後')).toBe('<p>前</p><p class="blank"></p><p>後</p>')
  })

  it('箇条書きの中の URL もリンクになる', () => {
    expect(boardBodyToHtml('- https://example.com/')).toBe(
      `<ul><li><a href="https://example.com/" target="_blank" rel="${REL}">https://example.com/</a></li></ul>`,
    )
  })
})

describe('markdownToHtml の差し替え口（既存の振る舞いを変えない）', () => {
  it('inline を渡さなければ従来どおり [[用語]]・縦中横が生きる', () => {
    expect(markdownToHtml('[[ユキ]]', new Set(['ユキ']))).toBe(
      '<p><span class="ref" data-ref-name="ユキ">ユキ</span></p>',
    )
    expect(markdownToHtml('12月')).toContain('tcy')
  })

  it('inline を渡すと行内だけが差し替わる', () => {
    expect(markdownToHtml('# [[ユキ]]', undefined, boardInlineHtml)).toBe('<h1>[[ユキ]]</h1>')
  })
})

describe('boardBodyToPlain', () => {
  it('記法の記号を剥がして 1 行にする', () => {
    expect(boardBodyToPlain('# 見出し\n- **項目**\n> 引用')).toBe('見出し 項目 引用')
  })

  it('前後の空白を落とし、連続する空白は 1 つに畳む', () => {
    expect(boardBodyToPlain('  あ　　い \n\n う ')).toBe('あ い う')
  })

  it('HTML は解釈も除去もせず、生の文字のまま返す（埋め込む側が textContent で扱う）', () => {
    expect(boardBodyToPlain('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })

  it('URL はそのまま残す', () => {
    expect(boardBodyToPlain('見て https://example.com/a')).toBe('見て https://example.com/a')
  })
})
