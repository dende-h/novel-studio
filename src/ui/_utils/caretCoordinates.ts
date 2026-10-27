/**
 * textarea のキャレット位置のピクセル座標（要素内 top/left）を求める。
 * ミラー div に同じ字形・余白を複製し、キャレット直前までのテキストを流し込んで、
 * 続く span の offset を読む定番手法（component/textarea-caret-position 由来）。
 * @ サジェストのポップアップをキャレットに追従させるために使う。
 * レイアウトを持たない環境（テストの happy-dom 等）では 0 にフォールバックする。
 */

// ミラーへ複製する字送り・余白関連のスタイル。これらが一致しないと座標がずれる。
const MIRRORED: string[] = [
  'writingMode',
  'textOrientation',
  'direction',
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
  width?: number
  top: number
  left: number
  height: number
}

export function getCaretCoordinates(el: HTMLTextAreaElement, position: number): CaretCoordinates {
  const doc = el.ownerDocument
  const win = doc.defaultView
  if (!win) return { top: 0, left: 0, height: 0 }
  try {
    if (win.getComputedStyle(el).writingMode === 'vertical-rl') {
      const measurer = createVerticalCaretMeasurer(el)
      try {
        return measurer.measure(position)
      } finally {
        measurer.dispose()
      }
    }
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

/**
 * 連続入力向けの計測器。段落のDOMを再利用し、変わった段落だけ再組版する。
 * 使い終えたらdisposeする（単発の補完位置取得はgetCaretCoordinatesを使う）。
 */
export function createCaretMeasurer(el: HTMLTextAreaElement): {
  measure: (position: number) => CaretCoordinates
  dispose: () => void
} {
  if (getComputedStyle(el).writingMode === 'vertical-rl') return createVerticalCaretMeasurer(el)
  const doc = el.ownerDocument
  const mirror = doc.createElement('div')
  mirror.setAttribute('aria-hidden', 'true')
  Object.assign(mirror.style, {
    position: 'fixed',
    height: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'hidden',
    left: '0',
    top: '0',
  })
  const span = doc.createElement('span')
  const nodes: HTMLDivElement[] = []
  let lines: string[] = []
  let activeLine = -1
  let signature = ''
  doc.body.append(mirror)

  return {
    measure(position) {
      try {
        const computed = getComputedStyle(el)
        const lineHeight = Number.parseFloat(computed.lineHeight)
        if (!Number.isFinite(lineHeight) || el.clientWidth <= 0)
          return { top: 0, left: 0, height: 0 }
        const values = MIRRORED.map((key) => computed[key as keyof CSSStyleDeclaration])
        const nextSignature = `${values.join('|')}|${el.clientWidth}`
        if (signature !== nextSignature) {
          for (const key of MIRRORED)
            mirror.style.setProperty(
              key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
              String(computed[key as keyof CSSStyleDeclaration]),
            )
          mirror.style.boxSizing = 'border-box'
          mirror.style.width = `${el.clientWidth + (Number.parseFloat(computed.borderLeftWidth) || 0) + (Number.parseFloat(computed.borderRightWidth) || 0)}px`
          for (const node of nodes) node.style.minHeight = `${lineHeight}px`
          signature = nextSignature
        }
        const nextLines = el.value.split('\n')
        const previousNode = nodes[activeLine]
        if (previousNode) previousNode.textContent = lines[activeLine] ?? ''
        const caret = Math.max(0, Math.min(el.value.length, position))
        const before = el.value.slice(0, caret)
        const index = before.split('\n').length - 1
        for (let i = 0; i < nextLines.length; i++) {
          const text = nextLines[i] ?? ''
          let node = nodes[i]
          if (!node) {
            node = doc.createElement('div')
            node.style.minHeight = `${lineHeight}px`
            mirror.append(node)
            nodes.push(node)
          }
          if (lines[i] !== text || i === activeLine) node.textContent = text
        }
        while (nodes.length > nextLines.length) nodes.pop()?.remove()
        lines = nextLines
        activeLine = index
        const node = nodes[index]
        if (!node) return { top: 0, left: 0, height: 0 }
        const text = lines[index] ?? ''
        const column = caret - (before.lastIndexOf('\n') + 1)
        node.textContent = text.slice(0, column)
        span.textContent = text.slice(column, column + 1) || '.'
        node.append(span, doc.createTextNode(text.slice(column + 1)))
        const box = span.getBoundingClientRect()
        const origin = mirror.getBoundingClientRect()
        return {
          top: box.top - origin.top - el.scrollTop,
          left: box.left - origin.left - el.scrollLeft,
          height: lineHeight,
        }
      } catch {
        return { top: 0, left: 0, height: 0 }
      }
    },
    dispose: () => mirror.remove(),
  }
}

/** 縦書きは高さで折り返し、右端からの距離をtextareaの負のscrollLeftへ対応させる。 */
function createVerticalCaretMeasurer(el: HTMLTextAreaElement) {
  const mirror = el.ownerDocument.createElement('div')
  mirror.setAttribute('aria-hidden', 'true')
  const before = el.ownerDocument.createTextNode('')
  const caret = el.ownerDocument.createElement('span')
  const after = el.ownerDocument.createTextNode('')
  mirror.append(before, caret, after)
  el.ownerDocument.body.append(mirror)
  return {
    measure(position: number): CaretCoordinates {
      try {
        const style = getComputedStyle(el)
        for (const key of MIRRORED)
          mirror.style.setProperty(
            key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
            String(style[key as keyof CSSStyleDeclaration]),
          )
        Object.assign(mirror.style, {
          position: 'fixed',
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          left: '0',
          top: '0',
          boxSizing: 'border-box',
          width: 'max-content',
          minWidth: `${el.clientWidth}px`,
          height: `${el.clientHeight}px`,
        })
        before.data = el.value.slice(0, position)
        caret.textContent = el.value.slice(position, position + 1) || '.'
        after.data = el.value.slice(position + 1)
        const box = caret.getBoundingClientRect()
        const origin = mirror.getBoundingClientRect()
        const width = Number.parseFloat(style.lineHeight) || 0
        return {
          left: el.clientWidth + box.left - origin.right - el.scrollLeft,
          top: box.top - origin.top - el.scrollTop,
          width,
          height: Number.parseFloat(style.fontSize) || 0,
        }
      } catch {
        return { top: 0, left: 0, width: 0, height: 0 }
      }
    },
    dispose: () => mirror.remove(),
  }
}
