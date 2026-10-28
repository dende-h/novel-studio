Linear COT-45「集中モードとタイプライタースクロール」を実装してください。

## 読むもの（この順で）
1. `CLAUDE.md`
2. `docs/specs/COT-45/spec.md` — 正本
3. `docs/specs/COT-45/requirements.md` と `design.md` — 受け入れ条件・コード根拠・テストの詳細
4. `docs/specs/COT-45/prototype.html` と `screens/` — PC/スマホの見た目
5. `docs/CODEMAP.md` — 執筆・共通部品・フックの節

## 作業範囲
- 既存: src/ui/App.tsx、components/AppShell/app-shell.tsx、components/TopAppBar/top-app-bar.tsx、components/EditorPane/editor-pane.tsx、index.css、docs/CODEMAP.md
- 新規案: components/SaveStatus/save-status.tsx、hooks/use-writing-mode.ts、hooks/use-typewriter-scroll.ts（いずれもsrc/ui配下）と対応テスト、e2e/writing-mode.spec.ts
- coreスキーマ、同期、課金、publish、MCP、既存useLocalFlagの契約は変更しない。

## 進め方
1. フックの双方向設定・キー除外・全画面所有権のテストを先に書く。
2. 保存表示を抽出し、同じtextareaを保持した集中切替を配線する。
3. 追従は実寸ブラウザで作り、IME・範囲選択・手動スクロールと既存候補の位置更新を確認する。
4. `.claude/skills/toc-copy/SKILL.md`を読んで文言を揃える。
5. `.claude/skills/codemap-update/SKILL.md`を読んでCODEMAPを更新する。

## 完了条件
- [ ] FR-1〜FR-5をrequirements.mdの各Given/When/Thenで検証
- [ ] 出入り時にdraft・選択・undo・元のパネル/表示面を保持
- [ ] PCと393pxでプロトタイプと見比べる
- [ ] pnpm typecheck / pnpm test / pnpm lint / pnpm buildと対象e2eが通る
- [ ] iOS Safari / Android ChromeのIME、キーボード、回転の結果を記録（未実施なら完了としない）
- [ ] 10万字で計測負荷を測り、design.mdの目標との差を記録

## 守る規約
src/coreはReactやsrc/uiをimportしない。状態管理の依存を追加しない。components/uiは編集しない。スキーマは既存フィールドを消さず必須化しない。本文valueに表示余白を入れない。全画面はdocument.documentElementを対象として既存portalを保つ。

## やらないこと
自動全画面、行強調、縦書き入力、OS設定、原稿や会員境界の変更。仕様成果物の存在をアプリ実装済みと扱わない。
