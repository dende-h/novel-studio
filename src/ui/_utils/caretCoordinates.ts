/**
 * textarea のキャレット位置のピクセル座標（要素内 top/left）を求める。
 * ミラー div に同じ字形・余白を複製し、キャレット直前までのテキストを流し込んで、
 * 続く span の offset を読む定番手法（component/textarea-caret-position 由来）。
 * @ サジェストのポップアップをキャレットに追従させるために使う。
 * レイアウトを持たない環境（テストの happy-dom 等）では 0 にフォールバックする。
 */

// ミラーへ複製する字送り・余白関連のスタイル。これらが一致しないと座標がずれる。
const MIRRORED: string[] = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
]

export interface CaretCoordinates {
  top: number
  left: number
  height: number
}

export function getCaretCoordinates(el: HTMLTextAreaElement, position: number): CaretCoordinates {
  const doc = el.ownerDocument
  const win = doc.defaultView
  if (!win) return { top: 0, left: 0, height: 0 }
  try {
    const computed = win.getComputedStyle(el)
    const div = doc.createElement('div')
    const ds = div.style as unknown as Record<string, string>
    const cs = computed as unknown as Record<string, string>
    ds.position = 'absolute'
    ds.visibility = 'hidden'
    ds.whiteSpace = 'pre-wrap'
    ds.wordWrap = 'break-word'
    ds.overflow = 'hidden'
    for (const prop of MIRRORED) ds[prop] = cs[prop] ?? ''
    doc.body.appendChild(div)

    div.textContent = el.value.slice(0, position)
    const span = doc.createElement('span')
    // 末尾位置でも高さを得るためダミー文字を入れる。
    span.textContent = el.value.slice(position) || '.'
    div.appendChild(span)

    const lineHeight = Number.parseInt(computed.lineHeight, 10)
    const fontSize = Number.parseInt(computed.fontSize, 10)
    const coords: CaretCoordinates = {
      top: span.offsetTop + (Number.parseInt(computed.borderTopWidth, 10) || 0) - el.scrollTop,
      left: span.offsetLeft + (Number.parseInt(computed.borderLeftWidth, 10) || 0) - el.scrollLeft,
      height: Number.isNaN(lineHeight) ? fontSize || 0 : lineHeight,
    }
    doc.body.removeChild(div)
    return {
      top: Number.isFinite(coords.top) ? coords.top : 0,
      left: Number.isFinite(coords.left) ? coords.left : 0,
      height: Number.isFinite(coords.height) ? coords.height : 0,
    }
  } catch {
    return { top: 0, left: 0, height: 0 }
  }
}
