import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { blocksToHtml } from './toHtml'

describe('blocksToHtml（ライブプレビュー描画）', () => {
  it('text は HTML エスケープされる', () => {
    expect(blocksToHtml(parseEpisodeBody('a<b>&c'))).toBe('<p>a&lt;b&gt;&amp;c</p>')
  })

  it('ruby は ruby/rt 要素に描画', () => {
    expect(blocksToHtml(parseEpisodeBody('漢字《かんじ》'))).toBe('<p><ruby>漢字<rt>かんじ</rt></ruby></p>')
  })

  it('傍点は em.dots（既定 = CSS text-emphasis 用）に描画', () => {
    expect(blocksToHtml(parseEpisodeBody('《《重要》》'))).toBe('<p><em class="dots">重要</em></p>')
  })

  it('空 paragraph は間（blank 段落）として描画', () => {
    expect(blocksToHtml(parseEpisodeBody('上\n\n下'))).toBe('<p>上</p><p class="blank"></p><p>下</p>')
  })

  it('sceneBreak は区切りに描画', () => {
    expect(blocksToHtml(parseEpisodeBody('前\n＊\n後'))).toBe('<p>前</p><hr class="scene-break" /><p>後</p>')
  })

  it('ruby の base/reading 内もエスケープ', () => {
    expect(blocksToHtml(parseEpisodeBody('｜a<b《よ&み》'))).toBe('<p><ruby>a&lt;b<rt>よ&amp;み</rt></ruby></p>')
  })
})
