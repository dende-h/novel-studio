import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { blocksToHtml } from './toHtml'

describe('blocksToHtml（ライブプレビュー描画）', () => {
  it('text は HTML エスケープされる', () => {
    expect(blocksToHtml(parseEpisodeBody('a<b>&c'))).toBe('<p>a&lt;b&gt;&amp;c</p>')
  })

  it('ruby は ruby/rt 要素に描画', () => {
    expect(blocksToHtml(parseEpisodeBody('漢字《かんじ》'))).toBe(
      '<p><ruby>漢字<rt>かんじ</rt></ruby></p>',
    )
  })

  it('傍点は em.dots（既定 = CSS text-emphasis 用）に描画', () => {
    expect(blocksToHtml(parseEpisodeBody('《《重要》》'))).toBe('<p><em class="dots">重要</em></p>')
  })

  it('空 paragraph は間（blank 段落）として描画', () => {
    expect(blocksToHtml(parseEpisodeBody('上\n\n下'))).toBe(
      '<p>上</p><p class="blank"></p><p>下</p>',
    )
  })

  it('sceneBreak は区切りに描画', () => {
    expect(blocksToHtml(parseEpisodeBody('前\n＊\n後'))).toBe(
      '<p>前</p><hr class="scene-break" /><p>後</p>',
    )
  })

  it('ruby の base/reading 内もエスケープ', () => {
    expect(blocksToHtml(parseEpisodeBody('｜a<b《よ&み》'))).toBe(
      '<p><ruby>a&lt;b<rt>よ&amp;み</rt></ruby></p>',
    )
  })

  it('1〜2 桁の半角数字は縦中横 span で包む', () => {
    expect(blocksToHtml(parseEpisodeBody('第1話'))).toBe('<p>第<span class="tcy">1</span>話</p>')
    expect(blocksToHtml(parseEpisodeBody('12月3日'))).toBe(
      '<p><span class="tcy">12</span>月<span class="tcy">3</span>日</p>',
    )
  })

  it('3 桁以上の半角数字は縦中横にしない（横倒し回避は漢数字に委ねる）', () => {
    expect(blocksToHtml(parseEpisodeBody('西暦2026年'))).toBe('<p>西暦2026年</p>')
  })

  it('傍点内の数字も縦中横で包む', () => {
    expect(blocksToHtml(parseEpisodeBody('《《30》》'))).toBe(
      '<p><em class="dots"><span class="tcy">30</span></em></p>',
    )
  })

  // ── @参照 ref の描画（P1・D-GLOS-PREVIEW-API = resolvedNames Set） ──
  it('GE-H1: 解決済み ref は span.ref で名前を描画（未解決クラス無し）', () => {
    const html = blocksToHtml(parseEpisodeBody('[[アリス]]'), new Set(['アリス']))
    expect(html).toBe('<p><span class="ref" data-ref-name="アリス">アリス</span></p>')
  })

  it('GE-H2: 未解決 ref は ref--unresolved マーカーを持つ', () => {
    const html = blocksToHtml(parseEpisodeBody('[[未登録]]'), new Set(['アリス']))
    expect(html).toBe(
      '<p><span class="ref ref--unresolved" data-ref-name="未登録">未登録</span></p>',
    )
  })

  it('GE-H2: 空名 ref は常に未解決', () => {
    expect(blocksToHtml(parseEpisodeBody('[[]]'), new Set())).toBe(
      '<p><span class="ref ref--unresolved" data-ref-name=""></span></p>',
    )
  })

  it('GE-H3: resolvedNames 未指定（EPUB 等 plain モード）は ref をプレーン化', () => {
    expect(blocksToHtml(parseEpisodeBody('私は[[アリス]]'))).toBe('<p>私はアリス</p>')
  })

  it('ref 名もエスケープ／数字は縦中横', () => {
    const html = blocksToHtml(parseEpisodeBody('[[A<2]]'), new Set(['A<2']))
    expect(html).toBe(
      '<p><span class="ref" data-ref-name="A&lt;2">A&lt;<span class="tcy">2</span></span></p>',
    )
  })
})
