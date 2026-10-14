# 推敲画面と「直す箇所」仕様書（COT-40）

- 要件: COT-41 ／ 設計: COT-42 ／ プロトタイプ: https://claude.ai/artifact/NQ5GfUrxqSMq1tPTYZkG19 （非公開。ローカルは `prototype.html`）
- 状態: レビュー通過（Round 5。経緯は `review.md`）
- 詳細: `requirements.md`（受け入れ条件の正本）・`design.md`（変更ファイル・データ・テストの正本）

## 何を作るか

小説の推敲を、執筆画面から PC 専用の「推敲」画面へ移す。作者は指摘ごとに「直す」か「このまま」かを選び、直すと決めた箇所だけが執筆画面の「直す箇所」に出る。
推敲画面では、端末内で動く形態素解析（lindera-wasm＋IPADIC）による指摘3種と、分析2種も使える。

## 振る舞い

- FR-1 小説のエディタから推敲チェックの欄を外す。脚本の書式チェックは変えない。執筆画面では推敲ルールを走らせない
- FR-2 「推敲」はサイドナビの「本文を書く」の直下に出す。出すのは無料会員と有料会員、小説、PC 幅のときだけ。入るときは未保存の本文を先に保存し、失敗したら移らずトーストを出す。幅を狭くしたら本文の画面へ戻す
- FR-3 推敲画面の本文は読むだけで、段落ごとに `plainTextOfBlock` の文字列を明朝で表示する
  - 印は、未判断が波線、直すが塗り、このままが印なし
  - 右の欄に「指摘｜分析」の切り替えと「未判断／直す／このまま」の絞り込みがある
  - 「確認する項目」は9項目。欄は最初から開いていて、どの項目も選ばれていない状態から作者が選ぶ（選んだ項目は端末に残る・localStorage `ns-proofread-on`）。チップにホバーすると説明が出る。自動の表記ゆれは「表記ゆれ」のスイッチに含める
- FR-4 指摘ごとに「直す」「このまま」「未判断に戻す」を選べる
  - 同じ項目・同じ文字列が2件以上あれば「同じ指摘をすべてこのまま（N件）」も出る
  - 「本文で直す」は執筆画面へ戻って該当箇所を選ぶ。別の話の指摘なら、その話を開いてから選ぶ
- FR-5 判断は話ごとに本文の外へ保存する（キー `proofread:<workId>:<episodeId>`）
  - 同期・クラウドバックアップ・手動バックアップに乗る。作品の完全削除でだけ消える
  - 同期の競合は LWW で決め、負けた側は退避一覧に載せない
- FR-6 執筆画面のツールバーに「直す箇所 N」を出す（PC・スマホとも。0件なら出さない）
  - 一覧の各行に「その箇所へ移る」と「外す」がある。Esc か外側で閉じる
  - 直ったかどうかは入力のたびに計算する。判断した出現の通し番号（重なりも数える）より、段落のその文字列の数が少なくなったら直ったとみなす
  - 位置はプレーン文字列から記法つきの行へ移して選ぶ。移せなければ段落全体を選び、トーストで知らせる
- FR-7 解析器と辞書は推敲画面を開いたときだけ取得し、Worker で動かす
  - 画面での呼び名は「くわしい確認」。2回目以降はオフラインでも動く
  - 失敗しても、正規表現の項目と「セリフと地の文」は動き続ける
  - 用語集の名前と別名は1語として扱い、指摘の対象から外す
- FR-8 品詞を使う指摘は3つ
  - 表記ゆれの自動発見：読みと品詞が同じで、漢字とかな・送り仮名・ひらがなとカタカナだけが違う語。辞書の指摘と重なる出現には出さない
  - 一文の中の同じ助詞：別の助詞も読点も挟まずに2回出たとき。隣り合う「がが」は除く
  - ら抜き言葉：地の文だけを調べる
- FR-9 分析は2つ。よく使う言葉（作品全体の副詞・形容詞の上位10件。押すと本文に印）と、セリフと地の文の割合（話ごと・作品全体）。どちらにも「直す／このまま」は付けない
- FR-10 COT-30 のルールは出現ごとに1件出す。各指摘は範囲と、直せば段落から消える文字列を持つ。当たる段落の集合は COT-30 と同じ
- FR-11 ヘルプの「推敲する」と `public/llms-full.txt` の説明を新しい流れに直す

## 画面

- 執筆画面（現状 `screens/editor-novel-desktop.png`・`editor-novel-mobile.png`）：① 下の欄を外す ② 「直す箇所 N」を検索・置換の手前に置く ③ 一覧（PC は幅 360px のカード、スマホは全幅） ④ その箇所を選択
- 推敲画面（撮影不可。参考は `screens/ref-plot.webp`）：⑤ サイドナビの行 ⑥ プロット画面と同じ組みの見出しと説明、話の選択、確認する項目、くわしい確認の状態（`Progress`） ⑦ 本文と印 ⑧ 右 384px の切り替えと絞り込み（`ViewTab` の見た目） ⑨ 指摘のカード ⑩ 分析

## 実装の骨格

| 層 | 主なファイル | 責務 |
|---|---|---|
| core | `src/core/proofread/{types,rules,variants,index}.ts` | 位置つき・出現ごとの指摘（`Finding`） |
| core | `src/core/proofread/morph/*`・`quotes.ts`・`dialogue-ratio.ts`・`user-dict.ts` | 品詞ルール・分析・ユーザー辞書 |
| core | `src/core/proofread/decisions.ts` | 判断のスキーマ・照合・`occurrencesOf`・`openFixes`・`locateFix` |
| core | `src/core/parser/parseNotation.ts` | `plainOffsetMap`（`scanInlines` に位置を報告する口を足す） |
| core | `src/core/storage/proofreadRepository.ts` | 判断の永続化（演出譜の写し） |
| ui | `src/ui/proofread/{analyzer.worker,analyzer-client,unzip}.ts`・`src/ui/hooks/{use-morph-analyzer,use-proofread-record}.ts` | 解析器と判断の配線 |
| ui | `src/ui/components/ProofreadView/*`・`FixListButton/*` | 推敲画面と「直す箇所」 |
| ui | `App.tsx`・`SideNav`・`Root.tsx`・`EditorPane`・`editorStore`・`sync-service`・`backup-service`・`ImportDialog`・`use-auto-backup`・`HelpPage` | 入口・配線・後始末・同期・バックアップ・案内 |
| build | `vite.config.ts`・`scripts/{fetch-dict,check-precache,gen-morph-fixtures}.mjs`・`public/_headers`・`package.json`・CI | 辞書の取得とハッシュ照合、プリキャッシュからの除外 |

データの差分は次の2つ。`Work`・`Episode`・`Block` は変えない。

- 新しい保存物 `ProofreadRecord { workId, episodeId, decisions[], updatedAt }`。各判断は `{ blockId, code, text, nth, occurrence?, anchor, verdict, message?, decidedAt }` で、未知の値は文字列のまま保持する
- `CloudBackupSchema.proofreads` を `.optional().default([])` で足す

## テスト

- unit（core）：出現ごとの指摘と範囲、品詞ルールの当たり外れ（実トークンのフィクスチャ）、判断の照合、`occurrencesOf`、`openFixes`・`locateFix` の例（重なり・指摘でない同じ文字列・ルビの読み・参照）、`plainOffsetMap` とパーサの一致、バックアップの旧形式
- integration：同期・バックアップ・完全削除・自動バックアップ、EditorPane、FixListButton、App の入口と「本文で直す」、ProofreadView（解析器は偽物）、Node で Worker の実物
- e2e：ゲストで推敲チェックが出ないこと、脚本の書式チェックが残ること、`.wasm` と `/dict/` を取りに行かないこと（PC・スマホ）。build 後に `check-precache.mjs` を走らせる。メモリと速度は stg で手動計測する

## 守ること

- 判断は本文の外に置き、`Work` 等を変えない。消すのは明示操作と作品の完全削除だけ
- 判断のスキーマの新しい欄は optional にし、未知の値も捨てない
- 解析器と辞書をプリキャッシュに入れない（`globIgnores` に `**/*.wasm`。入れ忘れるとビルドが止まる）
- 辞書は同じ配信元から取り、ハッシュを照合する。原稿を端末の外に出さない
- `src/core/` から React・`src/ui/`・`lindera-wasm` を import しない

## やらないこと

スマホの推敲画面、ゲスト向けの案内、文末の単調さ、AI 常套句、同じ語の連続の形態素化、利用者定義の表記ゆれ、自動修正、推敲画面での編集、判断の MCP・grove への公開、UniDic、話の削除時の後始末、競合で負けた判断の退避。
