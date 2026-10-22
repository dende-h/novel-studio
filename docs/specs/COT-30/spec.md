# 小説の推敲チェック（表記ゆれと原稿の作法） 仕様書（COT-30）

- 要件: COT-34 ／ 設計: COT-35 ／ プロトタイプ: https://claude.ai/artifact/5J3y2BLPxT8YjTskosUxm3（ローカル `docs/specs/COT-30/prototype.html`）
- 状態: レビュー通過（Round 4・independent）
- 詳細: `requirements.md`（受け入れ条件の全文）・`design.md`（辞書の正規表現・テスト計画）

## 何を作るか

小説のエディタ下部に、脚本の「書式チェック」と同じ見た目で「推敲チェック（確認候補 N件）」を出す。原稿の作法 6 項目と作品内の表記ゆれを純 TS で検査し、候補を押すと該当行を選択する。項目は端末ごとにオフにできる。本文は書き換えない。

## 振る舞い

**FR-1 表示**
- 小説（`Work.format` が `'script'` 以外）のとき、本文の下に `<details>`「推敲チェック（確認候補 N件）」。脚本は従来の「脚本の書式チェック」のまま。
- 本文が空・候補 0 件でも見出しは出て、一覧は空。例外を出さない。
- ゲスト・無料・有料で差はない。モバイルも同じ部品（フォーカス中は記法バーが覆う現状の挙動は変えない）。

**FR-2 作法ルール（行＝block 単位・プレーン文字列で検査・同じ項目は 1 行 1 件）**
- `indent`：行頭が `　「『【〈《（(“"‘'［[〔｛{—…―–＊｜` のどれでもない。
- `punct-before-close`：`[。、][」』）]`。
- `space-after-exclamation`：`！？` の直後が空白・`！？`・`…―`・閉じ括弧・行末のどれでもない。
- `leader-odd`：`…` の奇数連続、`―` の奇数連続、`・` の 2 つ以上連続。
- `halfwidth-punct`：日本語文字に隣接する半角 `!?` または `,.`。
- `successive-word`：助詞の重複（`がが・をを・でで・にに・とと・のの`、ただし「ものの・ひとと・なにに・までで・とともに」は外す）と、漢字を含む 2〜6 文字の隣り合う繰り返し（正規表現で繰り返しを取り、TS 側で捕捉に漢字があるときだけ）。
- `tools/novel-textlint/fixtures/novel-good.txt` で 0 件、`novel-bad.txt` で期待どおり（2 行目 punct、3 行目 indent、4 行目 halfwidth、7 行目 successive と leader）。

**FR-3 記法**
- ルビ・傍点・`[[参照]]`・`＊` は候補の原因にならない（`plainTextOfBlock` の結果を検査する）。

**FR-4 表記ゆれ**
- 組み込み辞書（design.md の表・約 40 組）と「算用数字＋助数詞／漢数字＋助数詞」（助数詞ごとに別の組）。
- 作品全体で 2 つ以上の書き方が 1 件以上あるときだけ、いま開いている話の該当行を候補にする。統一されている語は何も言わない。
- 件数は「いまの話＝編集中の本文」「他の話＝保存済み」。他の話の集計は話ごとにキャッシュし、自動保存で `work.episodes` が作り直されても同じ `Episode` 参照は再計算しない。
- メッセージ例：`「出来る」と「できる」が混ざっています（この作品で 出来る 3件・できる 12件）。どちらかに揃えると読みやすくなります。`／`数の書き方が算用数字と漢数字で混ざっています：人（2人・三人／算用 4件・漢数字 2件）。`（数は 1 行 1 件にまとめる）
- 辞書の文脈条件で「飛んできた・急いできた・仲良く・彼らしい・書いたし・泣いたせいで・十分に・三分の一」は数えない。取りこぼし（お願いできる・いたしております）は許容。

**FR-5 ジャンプ**
- 候補を押すと textarea にフォーカスし、該当行全体を選択（脚本と同じ `setSelectionRange`）。

**FR-6 項目のオン／オフ**
- 「確認する項目」に 7 つの切替（字下げ／閉じ括弧の前の句読点／！？の後の空白／三点リーダー・ダッシュ／半角の約物／同じ語の連続／表記ゆれ）。既定は全部オン。`aria-pressed`・高さ 44px 以上。
- オフにした項目は候補も件数も出ない。localStorage `ns-proofread-off`（JSON 配列）に保存し、作品をまたいで効く。読めない・壊れている値は「全部オン」。

## 画面

執筆画面（`#/write`・本文の面）。現状 `screens/editor-novel-desktop.png`、流用元 `screens/editor-script-desktop.png`。
1. 本文の下に `<details>`（脚本と同じ `border-t border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant`）。
2. 説明文：「原稿の作法と表記ゆれの確認候補です。本文は自動で書き換えません。意図した表現なら、そのまま使えます。」
3. 「確認する項目」の行：`rounded-full border px-3 min-h-11` のトグル、オン＝`bg-primary-container text-on-primary-container`、横並びで折り返す。
4. 候補一覧「N行：メッセージ」（既存と同じ `min-h-11 w-full py-1 text-left hover:text-primary`、`max-h-32 overflow-y-auto`）。
5. 押すと該当行を選択。
ヘルプ「基本の使い方」に「推敲する」を 1 項目追加（文言は design.md）。

## 実装の骨格

| 種別 | パス | 責務 |
|---|---|---|
| 新規 | `src/core/proofread/types.ts` | `ProofNotice`・`NovelRuleId`・`NOVEL_RULES`（切替の並びと表示名） |
| 新規 | `src/core/proofread/rules.ts` | `checkLine(text)`：作法 6 項目 |
| 新規 | `src/core/proofread/variants.ts` | 辞書 `VARIANT_GROUPS`・`countVariants`・`mergeCounts`・`variantNoticesForLine` |
| 新規 | `src/core/proofread/index.ts` | `proofreadNovel(blocks, { disabled?, baseCounts? })`・`countVariantsInBlocks`・`createVariantCountCache()`（`WeakMap<Episode, VariantCounts>`） |
| 新規 | `src/ui/hooks/use-proofread-prefs.ts` | `useProofreadPrefs()`：`useSyncExternalStore`＋localStorage。snapshot の Set は toggle 時だけ差し替える |
| 新規 | `src/ui/components/EditorPane/proofread-panel.tsx` | `<details>` 部品。脚本・小説で共有。`toggles` があるときだけ項目行を描く |
| 変更 | `src/ui/components/EditorPane/editor-pane.tsx` | props `variantBase?`。`notices` を `scriptMode` で `proofreadScript`／`proofreadNovel` に分岐。`<details>` を `ProofreadPanel` に置換 |
| 変更 | `src/ui/App.tsx` | `variantCache = useMemo(() => createVariantCountCache(), [])`。`variantBase` を他話から集計して渡す（`!work || work.format === 'script'` なら `undefined`） |
| 変更 | `src/ui/components/HelpPage/help-page.tsx` | 「推敲する」を追加 |
| 変更 | `docs/CODEMAP.md` | §1・§2 に行を追加 |

データモデルの変更なし。`src/core/script/proofread.ts` は触らない。

## テスト

- unit（`src/core/proofread/*.test.ts`）：各 code の当たり／外れ、記法行で 0 件、フィクスチャ 2 本、入力不変、辞書の当たり／外れ／取りこぼし例、数の助数詞別判定と exclude、`baseCounts` 合算、`disabled` で集計省略、キャッシュが同じ参照を再計算しない。
- integration（`editor-pane.test.tsx`・`use-proofread-prefs.test.ts`）：小説で出る・脚本で出ない、候補クリックで選択範囲、トグルで件数が減り localStorage に書かれる、壊れた値で落ちない。
- e2e：任意で 1 本（作品作成→本文入力→推敲チェックを開く→候補を押す）。

## 守ること

- スキーマ・同期・バックアップ・publish・MCP に変更を入れない。設定は localStorage のみ。
- 本文を書き換えない。候補は保存・書き出し・公開を止めない。
- 既存の脚本の書式チェックの見た目・文言・挙動を変えない（既存テストで固定）。
- 新しい npm 依存を足さない。`src/core/` は React と `src/ui/` を import しない。
- 誤検知は項目オフで逃がす設計。辞書の正規表現は design.md の表を正とし、変えるときは当たり／外れ例をテストに残す。

## やらないこと

AI 常套句の検出、形態素解析、利用者定義の表記ゆれ組、連続句読点・長音・マイナス記号のルール、脚本モードへの項目オン／オフ、本文の自動修正、モバイルで記法バーが `<details>` を覆う既存挙動の改善。
