# COT-31 敵対的レビューの記録

review_mode: independent（Claude Code の `spec-adversary` サブエージェント・`.claude/agents/spec-adversary.md`）
基準: `~/.claude/skills/linear-spec/references/spec-adversary.md`

## Round 1 — verdict: FAIL（blocker 0 / major 3 / minor 7）

| ID | 重さ | 指摘（要約） | 対応 |
|---|---|---|---|
| A-1 | major | UTF-8 fatal → Shift_JIS の2段階では、画像のリネーム等を弾けない（Shift_JIS デコーダは任意バイト列を黙って文字にする。PNG ヘッダで実測） | 対応：復号結果に U+FFFD か、タブ・改行以外の制御文字が1つでもあれば失敗、と requirements FR-1・design（`decodeTextFile`・`looksLikeText`）に明記。PNG ヘッダと NUL 入り UTF-8 のテストを追加 |
| A-2 | major | 「生テキスト 20MB で止めれば同期の 25MB 以内」は不成立。保存形は JSON で 2〜3 倍に膨らみ、同期は JSON 平文で判定・クライアントに 413 の個別処理なし | 対応：二段構えに変更。入力側は生テキスト合計 20MB で足切り、作成時は `workJsonBytes(buildImportedWork(...))` が 20MB 超なら保存せず「本文が大きすぎます。ファイルを分けて取り込んでください」。requirements の後方互換性節・design の方針／データモデル／ロジック／テスト計画／文言を更新 |
| A-3 | major | `DataMenuItem` に説明 prop は無く幅も 230px 固定。プロトタイプの新規項目だけ背景強調・幅 290px は既存と食い違う。`DropdownMenuItem` の記述は誤り | 対応：既存と同じ「ラベルのみ」に変更（説明を削除）。プロトタイプの幅 230px・強調なしに修正。`DropdownMenuItem` の記述を削除し「自前の `role="menu"`」と明記 |
| A-4 | minor | 手直しを index で持つと「前の話とつなげる」で後続がずれる | 対応：安定キー `episodeKey`（元ファイル名＋開始行）で `SplitEdits` を保持する `applyEdits` に置き換え。`mergeIntoPrevious` を削除。テストに「つなげた後も3話目の手直しが残る」を追加 |
| A-5 | minor | `screens/library-mobile.png` が存在せず、`new-work-dialog-desktop.png` は未参照 | 対応：参照を `library-empty-mobile.png` に修正。`new-work-dialog-desktop.png` はラジオの見た目の参照として design に記載 |
| A-6 | minor | `.md` も受けるのに文言と accept が `.txt` だけ | 対応：受け付けを `.txt` だけに絞る（issue の要求どおり）。`.md` は対象外に明記 |
| A-7 | minor | 貼り付けに容量上限が無く、性能 NFR の数値と桁が合わない | 対応：貼り付けも同じ上限に含むと明記。性能 NFR を「上限いっぱい（20MB・500話程度）で 1 秒以内」に揃えた |
| A-8 | minor | 「全画面高」と「既定の max-h」が相反。モバイル「次へ」の disabled 条件が未定義 | 対応：「既定の `max-h` のまま `DialogBody` をスクロール」に一本化。「次へ」の disabled 条件（0 件・空白のみ）を追記 |
| A-9 | minor | プロトタイプの元ファイル名表示が ⑦ に無い。⑧ の案内文がプロトタイプだけ長い | 対応：⑦ に元ファイル名を追記。案内文はプロトタイプを一文に揃えた |
| A-10 | minor | 右ペイン全体の `aria-live` は更新のたびに全話を読み上げる | 対応：`aria-live` を「N 話に分かれます・合計 M 字」の行だけに限定（design・プロトタイプとも） |

## Round 2 — verdict: PASS（blocker 0 / major 0 / minor 3）

前回の A-1〜A-10 はすべて解消と判定（A-2 は同期の平文が `canonicalWorkJson`＝`JSON.stringify(WorkSchema.parse(work))` で `workJsonBytes` と一致することまで確認済み）。

| ID | 重さ | 指摘（要約） | 対応 |
|---|---|---|---|
| B-1 | minor | 制御文字の範囲が requirements（U+000B・U+000C なし）と design で食い違う | 見送り：requirements.md:33 は既に「U+0000〜U+0008, U+000B, U+000C, U+000E〜U+001F」で design と一致している（指摘時点の読み違い）。変更なし |
| B-2 | minor | `accept=".txt,text/plain"` だと OS が text/plain と見なす `.md` `.log` が選択経路だけ通り、ドロップ経路と挙動が割れる | 対応：`accept=".txt"` にし、選択・ドロップとも同じ拡張子判定を通すと明記 |
| B-3 | minor | 安定キー「ファイル名＋開始行」は同名ファイルを2回追加すると衝突する。同名の扱いが未定義 | 対応：同名ファイルは「同じ名前のファイルはすでにあります」で追加しない（requirements FR-1・design・文言）。split.test.ts に同名ソースのケースを追加 |

合格後の変更は上記 minor の反映のみ（要件・設計の方向は変えていない）。
