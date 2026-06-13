# 02 — 記法仕様 ＋ 正本 block スキーマ

## 1. 方針

- **正本記法 = サイト互換**（小説家になろう / カクヨム）。書き出しが恒等に近く、作家の学習がゼロ。
- 独自概念（@参照）だけは独自記法とし、外部書き出し時は degrade。
- **正本（block JSON）はエディタライブラリ非依存**。パーサ（記法→正本）と各エクスポータ（正本→ターゲット）は `src/core`（純TS・TDD）に置く。

## 2. 記法マッピング

| 要素 | 記法 | 互換 | 外部書き出し |
|---|---|---|---|
| ルビ | `｜親文字《よみ》`（半角 `|` 可、親文字が漢字のみなら `｜` 省略可） | なろう/カクヨム | ほぼ恒等 |
| 傍点 | `《《テキスト》》` | カクヨム | なろうは傍点記法が無い → ルビで `・` を振る等に **degrade** |
| シーン区切り | `＊` のみの行 | 独自 | 各ターゲットの区切り表現へ |
| 段落（block） | **改行＝1 block**、空行＝空 block（間として保持） | なろう流 | 行構造を完全保存（恒等） |
| @参照 | `[[名前]]` | 独自・**P1** | 外部へは表示名のプレーンテキストに落とす／自前PF・EPUB はリンク化 |
| 強調・見出し | MVP では持たない（日本語小説で非慣用。話タイトルはメタ） | — | — |

## 3. 正本 block スキーマ（ドラフト）

> Zod でランタイムバリデーション。将来 `ref`（@参照）等を**後方互換で追加**できるよう設計する。

```ts
// src/core/schema (framework 非依存・純TS)
type Work = {
  id: string
  title: string
  // 表紙・帯・POP 等のメタは将来（公開ターゲット向け）
  episodes: Episode[]
}

type Episode = {
  id: string
  title: string
  blocks: Block[]
}

type Block =
  | { id: string; type: 'paragraph'; inlines: Inline[] }   // 空行は inlines: []
  | { id: string; type: 'sceneBreak' }
  // 将来: 'heading' | 'image'

type Inline =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; reading: string }
  | { type: 'emphasisDots'; text: string }      // 傍点
  // 将来: { type: 'ref'; name: string }         // @参照（P1）
```

## 4. パイプライン

```text
記法テキスト ──parse──▶ 正本 block 列(JSON) ──export──▶ EPUB / なろう / カクヨム
        ▲                      │
        └──── ライブプレビュー ◀┘ (正本 → HTML)
```

- **parse**: 行 split → 各行を inline 解析（ルビ/傍点を AST 化）。`＊` のみの行は `sceneBreak`。
- **export**: 正本を走査し各ターゲット記法/HTML/EPUB(XHTML+縦書きCSS) を生成。
- すべて純関数で **TDD 対象**（記法 → 正本 → 各ターゲットの往復テスト）。

## 5. 不変条件（テストで担保）

- なろう記法 → 正本 → なろう記法 が**恒等**（ルビ・行構造が保たれる）
- 空行・行数が往復で保存される
- 不正な記法（閉じ括弧欠落等）でパーサが壊れない（フォールバック挙動を定義）
