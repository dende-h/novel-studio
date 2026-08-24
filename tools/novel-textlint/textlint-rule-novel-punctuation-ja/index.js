'use strict'

// novel-punctuation-ja — 和文の小説原稿で general-novel-style-ja が見ない
// 約物の作法を補完する決定的チェック。
//   1. 和文中の半角感嘆符・疑問符（! ?）→ 全角（！ ？）にする
//   2. 和文中の半角カンマ・ピリオド（, .）→ 読点・句点（、 。）にする
// どちらも「日本語の文字に隣接している」場合だけ報告し、英数字の並び
// （URL・英文・データ表記など）には反応しない。

const JA = '[ぁ-んァ-ヶ一-龯々ー]'

const CHECKS = [
  {
    regex: new RegExp(`${JA}[!?]|[!?]${JA}`, 'g'),
    message: '和文では感嘆符・疑問符は全角（！ ？）を使う',
  },
  {
    regex: new RegExp(`${JA}[,.]|[,.]${JA}`, 'g'),
    message: '和文では句読点（、 。）を使う（半角カンマ・ピリオドは英文用）',
  },
]

module.exports = function novelPunctuationJa(context) {
  const { Syntax, RuleError, report, getSource } = context

  return {
    [Syntax.Str](node) {
      const text = getSource(node)
      for (const check of CHECKS) {
        check.regex.lastIndex = 0
        let match = check.regex.exec(text)
        while (match !== null) {
          report(
            node,
            new RuleError(`【要修正】「${match[0]}」: ${check.message}`, {
              index: match.index,
            })
          )
          match = check.regex.exec(text)
        }
      }
    },
  }
}
