'use strict'

// no-ai-cliche — AI が書いた日本語に高頻度で現れる常套句・翻訳調を辞書ベースで検出する。
// 辞書は ../dict/*.json にあり、options.dicts でどの辞書を使うか選ぶ
// （小説向けと toC 文言向けで辞書を差し替える）。
//
// 検出は「疑いの提示」であって自動修正の指示ではない。直すかどうかは
// 文脈で判断する（例: 会話文の中では登場人物の声として正当なことがある）。
// 辞書エントリの形式は dict/README を参照。

const fs = require('node:fs')
const path = require('node:path')

const DICT_DIR = path.join(__dirname, '..', 'dict')

function loadEntries(dictNames) {
  const entries = []
  for (const name of dictNames) {
    const file = path.join(DICT_DIR, name)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const entry of data.entries) {
      entries.push({
        regex: new RegExp(entry.pattern, entry.flags ?? 'g'),
        message: entry.message,
        level: entry.level ?? 'check',
      })
    }
  }
  return entries
}

const LEVEL_LABEL = {
  fix: '要修正',
  check: '要検討',
}

module.exports = function noAiCliche(context, options = {}) {
  const { Syntax, RuleError, report, getSource } = context
  const dictNames = options.dicts ?? ['ai-cliche-common.json']
  const entries = loadEntries(dictNames)

  return {
    [Syntax.Str](node) {
      const text = getSource(node)
      for (const entry of entries) {
        entry.regex.lastIndex = 0
        let match = entry.regex.exec(text)
        while (match !== null) {
          const label = LEVEL_LABEL[entry.level] ?? entry.level
          report(
            node,
            new RuleError(`【${label}】「${match[0]}」: ${entry.message}`, {
              index: match.index,
            })
          )
          if (match[0].length === 0) entry.regex.lastIndex += 1
          match = entry.regex.exec(text)
        }
      }
    },
  }
}
