# COT-6 実装状況（2026-09-26）

## 実装したもの

- Work の optional format、小説に戻すときのキー削除、一覧への形式反映。
- core/script の行判別・装飾を保つ話者分割・ト書きの行頭空白除去。
- 原稿用紙プレビュー（縦 20×20／横 40×40）、脚本の Word（A4/B5）とテキスト、grove 契約 v7 と未対応時の案内。EPUB・なろう・カクヨムは小説専用に戻した。
- 新規作成時の形式選択（既定は小説・初回保存に反映）、作品情報のラジオと説明、PC・スマホの記法ボタン、一覧の脚本バッジ、ヘルプ。
- MCP の形式パッチ・一覧・本文メタ情報。AI向け本文・フォルダzipの本文は変更なし。
- CODEMAP、記法仕様、リリースノート。PC・スマホのE2Eケースを追加。

仕様の変更一覧に加えて、ExportDialog/export-dialog.tsx と PublishPage/publish-page.tsx を変更。
実際のダウンロード時に work.format を exporter へ渡すため。追加テストは
src/core/exporter/script.test.ts、functions/api/_lib/mcp-server.test.ts、
src/ui/_utils/exporters.test.ts、e2e/mobile.spec.ts にも配置した。

## 検証

- pnpm typecheck: 成功。
- pnpm test: 170ファイル、2352件成功、1件todo。
- その後のMCP・書き出し・キャレット境界の追加検証: 4ファイル、108件成功。
- pnpm lint: 成功（既存の警告29件・info3件あり）。
- pnpm build: 成功（chunkサイズの警告あり）。
- git diff --check: 成功。CODEMAP の実パス検査: 欠落なし。
- Playwright: 追加2ケースを検出。実行は開発サーバー起動時の
  listen EPERM 127.0.0.1:5173 で停止。ブラウザ上の見た目・操作は未検証。

## 未完了と再開条件

作業中に環境が制限モードへ切り替わり、git add が次の理由で失敗した。

    Unable to create '/home/dende/novel-studio/.git/worktrees/4216-cf46fb2f-010f-4e77-b2de-21ca73e9ab88/index.lock': Read-only file system

未コミット。push・PR作成・stg反映・Linear完了更新は行っていない。
ローカルサーバー起動と上記Git管理ディレクトリの書込みが許可された環境で再開が必要。
gh auth status も認証失敗を報告したため、ネットワークが利用できる環境で再確認する。

実装元HEADは eb5b2d3。作業前にfetchした origin/stg は aa773eb。
最新stgには用語集の対話機能など別の変更がある。まだ統合していない。
再開時は最新stgを取り込み、競合解消後に全検証、PC・スマホのプロトタイプ比較、
stgへのpushとCI・Cloudflare Pagesデプロイ成功確認を行う。mainへの反映はしない。
grove v7対応の先行リリース条件は継続。

開始時からあった .claude/skills/linear-spec/SKILL.md と .tokensave/* の変更は
今回の実装と無関係。コミットへ混ぜない。docs/specs/COT-6 の元仕様成果物も
開始時点では未追跡だった。旧プロバイダのセッション記録は変更していない。

## 追加要望への対応

新規作成の形式選択に加え、小説でもセリフを挿入できるよう変更（丸括弧・隅付き括弧のボタンは利用頻度が低いため削除。場面転換は脚本のみ）。
記法一覧とキー処理は EditorPane/notation.ts で共有し、PC ツールバーでは各ボタンのラベルの下にキーを表示する（スマホの記法バーには出さない）。追加キーはCtrl+Alt（MacはCtrl+Option）と英字。ト書きは PC では Tab / Shift+Tab と Enter の字下げ継続で入れ、ボタンはスマホの記法バーだけ（「ト書き」「ト書き解除」）。
core/script/proofread.ts とエディタ下部に、本文を変更しない脚本の書式チェックを追加。
柱・話者名・括弧の対応を確認候補として表示し、クリックで該当行を選択する。
2026-09-26 に E2E（PC・スマホ、全31件）を実行して通過。Windows の AltGr 配列や Mac の Ctrl+Option での実機挙動は未確認。

ト書きの3字下げ挿入（連打でも増えない）・場面転換の *** 行挿入を追加。
*** は脚本で場面転換として描画し、参照ボタンの表示名を「用語引用」に変更。

## 脚本の出力を原稿用紙プレビュー＋テキストへ（2026-09-26〜27 追加要望）

EPUB・なろう・カクヨムは小説専用に戻し、脚本は原稿用紙（既定 20字×20行・縦書き）をプレビューにした。
core/script/layout.ts が流し込み・禁則・頁割り・前付けを担い、ui/components/ScriptSheet が紙を描く（文字の大きさは読書サイズ）。
一度 PDF（ブラウザ印刷）で作ったが、公募の規定が多様なため取り下げ、Word 等へ貼って手直しできる「脚本テキスト」（.txt）に変えた。
規定の追従：セリフ2行目の1字下げ、！？の後ろ1マス、ノンブルは本文から 1、登場人物表＝用語集の人物、梗概＝Work.synopsis（作品情報に欄追加・MCP set_work_meta にも synopsis・grove へは送らない）。
書式チェックに句点・算用数字・カメラワーク・登場人物表に無い話者を追加。
脚本モードは Work 丸ごとを運ぶバックアップ・同期・フォルダ zip・MCP のいずれにも乗る（format・synopsis とも optional で旧データ互換）。

検証（2026-09-27 テキスト出力へ変更後）: typecheck 成功、ユニット 174 ファイル 2,406 件成功、E2E 31 件成功、build 成功。
プレビューは欄の幅に合わせて紙を縮める（縦書きの1列目が右端で切れないように）。

## Word 出力（2026-09-27 追加要望）

提出用テンプレート（A4_20_20_14 / B5_20_20_12 の .docx）を解析し、同じ用紙・余白・縦書き・行グリッド・段落スタイル（柱書き／ト書き／セリフ）・フッターの PAGE を core/exporter/toDocx.ts で再現。
依存ライブラリは足さず、必要な XML パートだけを自前 zip に入れる。表紙・人物一覧表・あらすじ・本文はそれぞれ別ページ（前付けは別の節）、ページ番号は本文から 1。既定の出力を Word A4 にし、テキストも残した。
生成物は Python の zipfile/minidom で整形式を確認。Word 実機での開封は未確認（サンプルを Downloads/コトノハ脚本サンプル に置いた）。
