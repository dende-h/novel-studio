# novel-textlint

小説原稿と toC 文言（LP・アプリ内案内）を textlint で機械検査する道具。
アプリ本体（ルートの `package.json`）とは独立した自己完結パッケージで、CI・ビルドには影響しない。
利用側のスキルは `.claude/skills/novel-writing/` と `.claude/skills/toc-copy/`。

## 使い方

```bash
pnpm --dir tools/novel-textlint install        # 初回のみ
pnpm --dir tools/novel-textlint lint:novel <ファイル>   # 小説原稿（.txt / .md）
pnpm --dir tools/novel-textlint lint:copy  <ファイル>   # LP・アプリ内文言
pnpm --dir tools/novel-textlint check:fixtures          # ルール変更後の回帰チェック
```

検出件数に関わらず exit 0（lint であって CI ゲートではない）。severity はすべて warning。
`--fix` を付けると general-novel-style-ja の機械修正可能な指摘（閉じ括弧前の句読点など）を自動修正できる。

## レーンとルール構成

| レーン | 設定 | ルール |
|---|---|---|
| 小説 | `.textlintrc.novel.json` | `general-novel-style-ja`（小説作法） + `novel-punctuation-ja`（半角約物の補完・自作） + `ja-no-successive-word`（同語連続） + `no-ai-cliche`（common + novel 辞書） |
| toC 文言 | `.textlintrc.copy.json` | `ja-no-successive-word` + `no-ai-cliche`（common + copy 辞書） |

`general-novel-style-ja` が見る小説作法: 段落頭の字下げ、閉じ括弧直前の句読点禁止、
三点リーダー・ダッシュの偶数連続、！？後の全角スペース、句読点・中黒・長音・マイナスの適切な使用。

novel-studio の記法（ルビ `｜親《よみ》`・傍点 `《《》》`・シーン区切り `＊`・`[[参照]]`）は
誤検知しないよう調整済み（`chars_leading_paragraph` に `＊｜` を追加、`ja-no-successive-word` の
allow に `《》` を登録）。

## カスタマイズ

- **AI 臭辞書**: `dict/*.json`。エントリは `{pattern（正規表現）, message, level}`。
  `level: "fix"` = 原則直す / `"check"` = 文脈で判断。辞書の追加・削除は
  `.textlintrc.*.json` の `no-ai-cliche.dicts` で切り替える。
- **字下げ検査をやめたい**: `.textlintrc.novel.json` の `chars_leading_paragraph` を `false` に。
- **他の作法の on/off**: `general-novel-style-ja` のオプション
  （<https://github.com/io-monad/textlint-rule-general-novel-style-ja>）を同じ場所で上書き。
- ルール・辞書・fixture を変えたら `check:fixtures` の期待値を更新して回す。

## 構成

```
.textlintrc.novel.json / .textlintrc.copy.json   # レーン別設定
dict/ai-cliche-{common,novel,copy}.json          # AI 臭辞書（カスタマイズの主戦場）
textlint-rule-no-ai-cliche/                      # 辞書駆動の自作ルール（file: 依存）
textlint-rule-novel-punctuation-ja/              # 半角約物チェックの自作ルール（file: 依存）
fixtures/ + check-fixtures.sh                    # 回帰チェック
```

辞書の設計は [coji/natural-japanese](https://github.com/coji/natural-japanese)（MIT）の
禁止語・翻訳調カタログを参考に、小説・toC 向けに再編したもの。
