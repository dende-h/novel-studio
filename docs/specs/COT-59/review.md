# 敵対的レビューの記録

- review_mode: independent（Claude Code のサブエージェント `spec-adversary`・基準 `~/.claude/skills/linear-spec/references/spec-adversary.md`）

## Round 1 — FAIL（major 4・minor 11）

| ID | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| A-1 | major | 登録で用語集が変わると Worker が作り直され、欄が準備中に置き換わって一覧が数秒消える。「解析し直しを待たない」が登録では成り立たない | 対応。前回の `analysis.names` を作り直し中も出し続け、準備中は前回の結果が無いときだけにした（design.md 方針・UI 状態・ロジック、requirements.md FR-3・FR-4 の受け入れ条件、テスト計画） |
| A-2 | major | 架空の名前61個の一覧がリポジトリに無く、基準の55個を再現できない | 対応。design.md 付録 A に一覧・文の型・数え方を書き、フィクスチャ `fictional-names.json` を変更ファイルに足した。基準の数は実装の最初に今の辞書で数えて固定する |
| A-3 | major | samples.json を新しい辞書で作り直すと、「区切りが変わらない」が自分自身との比較になる | 対応。samples.json は作り直さず基準に残す。`gen-morph-fixtures.mjs` に `--names` を足して names.json だけを書けるようにした |
| A-4 | major | 新しいロジックの受け入れ条件にテストの置き場所が無いもの（この話に無い名前・名前を直した作成・キャンセル・未分類・本文から無くなった外した語・壊れた記録・キャッシュ差し替え・zip の大きさ） | 対応。proofread-view.test.tsx と App.test.tsx の行に書き足し、zip の大きさは node テストと build-dict.mjs、キャッシュの差し替えは既存の処理に任せて手動の確認に回した |
| A-5 | minor | 「一般の語」「辞書の人名・地域・組織」が未知語を含むか未定 | 対応。原形が `*` でない語に限ると定め、未知語に分類を付けないことを FR-2 の受け入れ条件に足した |
| A-6 | minor | requirements の「欄はすべて optional」と design の必須の欄が食い違う | 対応。核の欄は必須、今後足す欄は optional と直した |
| A-7 | minor | U1 が未決なのに FR-5 は同期前提 | 対応。ユーザーに確認し、同期すると決定（2026-10-18）。受け入れ条件に「有料の同期が動いていれば」を添えた |
| A-8 | minor | 「出現すべてに点線」は、指摘の印と重なる箇所が描かれない今の重ね方と食い違う | 対応。「指摘の印と重ならない出現すべて」と直した |
| A-9 | minor | 「五十音順」と `localeCompare('ja')` が食い違う | 対応。受け入れ条件を `localeCompare('ja')` の順と直した |
| A-10 | minor | 例の「スマホ」は新しい辞書では候補にならない | 対応。例を「新宿」に替えた |
| A-11 | minor | `quickCreateName` の他の呼び出し（:399・:541・:548）が表に無い。publish の根拠が別物 | 対応。App.tsx の行番号を足し、publish の根拠を `src/ui/_api/publish.ts:157` に替えた |
| A-12 | minor | 取り込み画面の文言「外した名前」が推敲画面とそろわない。文言と撮影しない理由が無い | 対応。「推敲で外した語」にそろえ、取り込みとヘルプの文言と撮影しない理由を UI 節に書いた |
| A-13 | minor | 除外リストに妹・弟・娘・嫁・孫が無い。義訓のルビの誤りがリスクに無い | 対応。リストに足し（息子も）、妹ちゃんの受け入れ条件を足した。義訓のルビをリスクに書いた |
| A-14 | minor | 行が消えたときのフォーカスの行き先が未定 | 対応。次の行（無ければ前の行・見出し）と決め、登録はダイアログを閉じたあとに移す仕組みを UI 節に書いた |
| A-15 | minor | 新しい zip のファイル名が未定。SudachiDict の改変の旨の手当てが無い | 対応。`lindera-ipadic-6.2.0-sudachi20260723.zip` と決め、`NOTICE-sudachidict.txt` に LICENSE・LEGAL と改変の旨を入れると書いた |

## Round 2 — FAIL（major 1・minor 3）

Round 1 の A-1〜A-13・A-15 は解消。A-14 は B-1 に引き継ぎ。

| ID | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| B-1 | major | 登録では、行はダイアログが開いたまま先に消える（`editorStore.ts:715-718`→`glossary-entry-form.tsx:154-163`）。モーダルがフォーカスを閉じ込め、フォームは DialogTrigger を持たないので閉じると body に落ちる。App.test.tsx にフォーカスの検証が無い | 対応。`GlossaryEntryForm` に省略できる `onCloseAutoFocus` を足し、`onRegisterName` が `Promise<'created' \| 'cancelled'>` を返す形にした。App は `onCloseAutoFocus` で `preventDefault()` してから resolve し、ProofreadView が閉じた時点でフォーカスを移す（キャンセルなら押したボタンへ戻す）。変更ファイル・ロジック・App.test.tsx の行と FR-4 の受け入れ条件に足した |
| B-2 | minor | 「辞書にある語」の定義を手がかりの箇条の途中に差し込み、ルビと `[[ ]]` がその子になった | 対応。定義を手がかりの箇条の後ろへ移した |
| B-3 | minor | 「重なる箇所は指摘の印が勝つ」は、先に始まる印を優先する今の重ね方と違う | 対応。「先に始まる印だけを描く」に直した（requirements FR-3・design UI ③） |
| B-4 | minor | 準備中の受け入れ条件に「前回の結果が無いとき」の限定が無く、作り直し中の条件と食い違う。参照行がずれている | 対応。限定を足し、参照行を `analysis-panel.tsx:52-54`・`:49-50` に直した |

## Round 3 — PASS（minor 3）

Round 2 の B-1〜B-4 はすべて解消。

| ID | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| C-1 | minor | 名前を直して作成した場合（作成は成功・行は残る）のフォーカスの行き先が無い | 対応。「created でも行が残っていれば、その行の名前のボタンへ戻す」を design の UI 節と FR-4、App.test.tsx の行に足した |
| C-2 | minor | `onCloseAutoFocus` を何を見て渡すかが未定。state を見ると閉じる時点で外れ、Promise が resolve されない | 対応。常に同じ handler を渡し、resolve の ref があるときだけ働く形を design に明記した |
| C-3 | minor | 参照行のずれ（`DialogContent` は :172）と setter の名前 | 対応。`:171-172` に直し、`quickCreate`／`setQuickCreate` へ改名する旨を書いた |
