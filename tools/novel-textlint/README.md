# novel-textlint

小説原稿を [textlint](https://github.com/textlint/textlint) で機械検査する道具。
アプリ本体（ルートの `package.json`）とは独立した自己完結パッケージで、CI・ビルドには影響しない。
利用側のスキルは `.claude/skills/novel-writing/`。

## 使い方

```bash
pnpm --dir tools/novel-textlint install                 # 初回のみ
pnpm --dir tools/novel-textlint lint:novel <ファイル>   # 小説原稿（.txt / .md）
pnpm --dir tools/novel-textlint check:fixtures          # ルール変更後の回帰チェック
```

検出件数に関わらず exit 0（lint であって CI ゲートではない）。severity はすべて warning。
`--fix` を付けると general-novel-style-ja の機械修正可能な指摘（閉じ括弧前の句読点など）を自動修正できる。

## ルール構成（`.textlintrc.novel.json`）

| ルール | 役割 |
|---|---|
| `general-novel-style-ja` | 小説の原稿作法: 段落頭の字下げ、閉じ括弧直前の句読点禁止、三点リーダー・ダッシュの偶数連続、！？後の全角スペース、句読点・中黒・長音・マイナスの適切な使用 |
| `novel-punctuation-ja`（自作） | 上記が見ない半角約物の補完（和文中の `!?` `,.`） |
| `ja-no-successive-word` | 同語の連続（「がが」等の打ち間違い） |
| `no-ai-cliche`（自作） | AI 常套句・翻訳調の辞書検出。`【要修正】`＝原則直す / `【要検討】`＝文脈で判断 |

novel-studio の記法（ルビ `｜親《よみ》`・傍点 `《《》》`・シーン区切り `＊`・`[[参照]]`）は
誤検知しないよう調整済み（`chars_leading_paragraph` に `＊｜` を追加、`ja-no-successive-word` の
allow に `《》` を登録）。

## カスタマイズ

- **AI 臭辞書**: `dict/*.json`。エントリは `{pattern（正規表現）, message, level}`。
  `level: "fix"` = 原則直す / `"check"` = 文脈で判断。使う辞書は
  `.textlintrc.novel.json` の `no-ai-cliche.dicts` で切り替える。
- **字下げ検査をやめたい**: `.textlintrc.novel.json` の `chars_leading_paragraph` を `false` に。
- **他の作法の on/off**: `general-novel-style-ja` のオプション
  （<https://github.com/io-monad/textlint-rule-general-novel-style-ja>）を同じ場所で上書き。
- ルール・辞書・fixture を変えたら `check-fixtures.sh` の期待値を更新して回す。

## 構成

```
.textlintrc.novel.json                     # 設定（ルールの on/off・オプションはここ）
dict/ai-cliche-{common,novel}.json         # AI 臭辞書（カスタマイズの主戦場）
textlint-rule-no-ai-cliche/                # 辞書駆動の自作 textlint ルール（file: 依存）
textlint-rule-novel-punctuation-ja/        # 半角約物チェックの自作 textlint ルール（file: 依存）
fixtures/ + check-fixtures.sh              # 回帰チェック
```

辞書の設計は [coji/natural-japanese](https://github.com/coji/natural-japanese)（MIT）の
禁止語・翻訳調カタログを参考に、小説向けに再編したもの。
