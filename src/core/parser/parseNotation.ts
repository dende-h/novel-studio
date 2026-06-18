import type { Block, Inline } from '../schema'

/**
 * なろう/カクヨム互換の記法 → 正本 block 列。
 * - 改行 = 1 block（空行も空paragraphで保持）
 * - ＊ のみの行 = sceneBreak
 * - ルビ: ｜親文字《よみ》（半角| 可、漢字親文字はパイプ省略可）
 * - 傍点: 《《テキスト》》
 * 純関数（テストの主戦場）。
 */

const SCENE_BREAK = '＊'
// 自動ルビ（パイプ省略）の親文字に許す漢字レンジ
const KANJI = '\\u4E00-\\u9FFF\\u3005\\u3006\\u30F5\\u30F6'
const AUTO_RUBY_RE = new RegExp(`^([${KANJI}]+)《([^》]+)》`)

export function parseEpisodeBody(text: string): Block[] {
  return text.split('\n').map((line, i) => {
    const id = `b${i + 1}`
    if (line === SCENE_BREAK) return { id, type: 'sceneBreak' }
    return { id, type: 'paragraph', inlines: parseInlines(line) }
  })
}

export function parseInlines(line: string): Inline[] {
  const inlines: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) {
      inlines.push({ type: 'text', text: buf })
      buf = ''
    }
  }

  let i = 0
  while (i < line.length) {
    // @参照: [[名前]]（P1）。区切りは ]] または行末。前後 trim（半角/全角空白）。
    // 中身の存在に関わらず常に ref（未終端・空も ref 化）。name 内部は非解釈の literal。
    if (line.startsWith('[[', i)) {
      const end = line.indexOf(']]', i + 2)
      const inner = end === -1 ? line.slice(i + 2) : line.slice(i + 2, end)
      flush()
      inlines.push({ type: 'ref', name: inner.trim() })
      i = end === -1 ? line.length : end + 2
      continue
    }

    // 傍点: 《《 ... 》》
    if (line.startsWith('《《', i)) {
      const end = line.indexOf('》》', i + 2)
      if (end !== -1) {
        flush()
        inlines.push({ type: 'emphasisDots', text: line.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }

    // 明示ルビ: ｜base《reading》 / |base《reading》
    if (line[i] === '｜' || line[i] === '|') {
      const open = line.indexOf('《', i + 1)
      const close = open === -1 ? -1 : line.indexOf('》', open + 1)
      if (open !== -1 && close !== -1) {
        flush()
        inlines.push({
          type: 'ruby',
          base: line.slice(i + 1, open),
          reading: line.slice(open + 1, close),
        })
        i = close + 1
        continue
      }
    }

    // 自動ルビ: <漢字列>《reading》
    const auto = AUTO_RUBY_RE.exec(line.slice(i))
    if (auto) {
      flush()
      inlines.push({ type: 'ruby', base: auto[1] as string, reading: auto[2] as string })
      i += auto[0].length
      continue
    }

    buf += line[i]
    i++
  }
  flush()
  return inlines
}
