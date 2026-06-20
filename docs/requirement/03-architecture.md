# 03 — 技術土台・リポ構成・依存ポリシー

## 1. スタック

- **新規リポで再出発**（旧 Turborepo / Next.js / 別BE 前提 clean architecture は不採用）
- 土台 = **Vite + React + PWA**（`vite-plugin-pwa`）
- UI = **shadcn/ui**（コピーして所有）、URL状態 = **nuqs**、スタイル = Tailwind
- 永続化 = **ネイティブ IndexedDB を薄い自前ラッパで包む**（依存ゼロ・所有・TDD）。格納は正本 block JSON バンドル

## 2. core / ui 境界（最重要）

モノレポにせず、単一リポ内で境界を引く:

```text
src/
├── core/                     ← 純TS・React 非依存・TDD の中心
│   ├── schema/               : 正本 block スキーマ（Zod）
│   ├── parser/               : 記法 → 正本（純関数）
│   ├── exporter/             : 正本 → EPUB / なろう / カクヨム（純関数）
│   └── storage/              : IndexedDB 薄ラッパ（型付き/Promise化/tx管理）
└── ui/                       ← React / PWA / shadcn / nuqs
```

- **`core/` は `ui/` や React を import できない**（lint ルールで強制）
- `core/` は将来 公開プラットフォーム からも再利用（切り出すだけ＝既に疎結合）

## 3. 依存ポリシー

| 区分 | 方針 |
|---|---|
| 受け入れる土台 | React・Vite（ビルド時）・Tailwind（ランタイム依存なし）・Zod（正本検証の核） |
| コピーして所有 | shadcn/ui・nuqs・ユーティリティは自前 |
| 依存が正当化される核 | なし（エディタは A1=textarea＋自前パーサで回避済み。将来 WYSIWYG 化する時のみ ProseMirror/CodeMirror6 を検討） |
| 避ける | 重い抽象ラッパ・大型UIライブラリ・churn の激しい依存・グローバル state ライブラリ（Redux/Zustand） |

> 新しい依存を足す前に「**コピーして所有できないか**」を先に検討する。

## 4. component / コード設計（旧 novel-platform の思想を継承・確定）

**継承（確定）**:
- **Presentational / Container パターン**（Presentational は Props のみ。fetch/useState/useEffect/ビジネスロジックを持たない）
- **1ファイル1コンポーネント**（PascalCase ディレクトリ＋kebab ファイル、1 export）
- 純関数は `_utils/`、hooks は **React ライフサイクル依存のみ**（判断基準: React import が必要か）
- URL 表現可能な状態は **nuqs**

**状態管理（確定）**: client-heavy なエディタ状態（原稿/カーソル/自動保存・dirty/undo/分割ペイン/開いている作品・話）は **自前の最小ストア（`useSyncExternalStore` ＋ ~数十行）** で管理。外部 global-state ライブラリ（Redux/Zustand）は**不使用**。状態ロジックは可能な限り `core/` 寄りにして TDD。Presentational は Props のみ、Container がストアを購読。

**Storybook（暫定: 不採用）**: 依存が重く dep-minimal 哲学と衝突するため採らない。代替＝自前の軽量コンポーネントギャラリー（`/dev` ルート等・所有・ゼロ依存）＋ Vitest + Testing Library のコンポーネントテスト。※override 可。

**破棄**（dropped stack 由来）: Actions → Adapter → Usecase → Repository → Backend API、RSC 前提、stub-repository。`core/ui` 境界が置き換える。

## 5. テスト

- **TDD**。`core/`（schema/parser/exporter/storage）が純関数中心でテストの主戦場
- ランナー = Vitest（想定）

## 6. バックアップ / 同期

- MVP: 手動エクスポート/インポート（構造化バンドル）＋ ローカル `persist()`
- optin: アカウント＋**at-rest 暗号化クラウド同期**（鍵はサーバ管理＝復旧可）。E2E は将来の上級/有料オプションへ温存
- 同期サーバの技術選定は確定＝Cloudflare Workers/D1/R2 ＋ Clerk（認証・課金）→ [05-sync.md](./05-sync.md)。実装時期のみ未決（→ 99）
