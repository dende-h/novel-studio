# 09 — 掲示板（利用者の声を集める場と、作者同士の交流）

> 2026-08 決定。声の受け口だった Google フォーム 1 本を、**記名式の公開スレッド**に置き換える。
> フォームは「記名では言いにくい声」の逃げ道として残す。

## 0. なぜ要るのか

いまの受け口は、ヘルプページの Google フォーム 1 本だけ（`src/ui/components/HelpPage/help-page.tsx:6`）。
これには 2 つ穴がある。

1. **届いた声が本人にしか見えない。** 同じ要望が何人から来ているか利用者に分からず、
   直したことも伝わらない。「言っても届かない」と思われた時点で次の声は来ない。
2. **利用者同士がつながらない。** 一人で書く道具なので、作者が孤立したまま離脱する。

この 2 つは同じ器で解ける。ただし成立条件が正反対で、**声集めは利用者 1 人でも成立するが、
交流は人が集まらないと成立しない**。過疎ったスレが並ぶ画面は「誰も使っていない」証拠を
自分で掲示することになるので、そこを設計で殺しておく（§2 の呼び水スレ）。

## 1. 決めたこと

| ID | 決定 |
|---|---|
| **D-BOARD-SIGNED** | **記名式・ログイン必須**（Clerk）。匿名投稿は作らない。表示名で書くぶん荒れにくく、レート制限・投稿禁止のキー（`user_id`）も自然に手に入る。認証は既存 `functions/api/_lib/auth.ts` の `verifyUserId` をそのまま使う（会員判定は不要＝**無料アカウントで書ける**）。 |
| **D-BOARD-NAME** | 表示名は**掲示板専用のプロフィール**（D1 `board_profiles`）に持つ。初期値は grove の作者ペンネーム（`/api/authors/me`）→ ローカルの `Profile.penName`（`src/core/profile/index.ts`）の順に**提案するだけ**で、grove の作者登録は投稿の条件にしない。正規化後に重複する名前と予約語（運営・公式・admin・コトノハ 等）は拒否。過去の投稿にも**現在の表示名**を出す（非正規化しない＝改名が全投稿に反映される）。 |
| **D-BOARD-OPEN** | スレ立ては**最初から全員に開放**。空の一覧を見せないよう、運営が呼び水スレを先に立てておく（§2）。摩擦を足す代わりに、レート制限（スレ 3 本/日・投稿 10 件/時）で守る。 |
| **D-BOARD-KIND** | スレに**種別**を持たせる（`suggestion` 目安箱 / `request` 要望 / `bug` 不具合 / `chat` 雑談 / `intro` 自己紹介 / `promo` 作品紹介）。👍 と運営ステータスが付くのは `request` と `bug` だけ。 |
| **D-BOARD-STATUS** | 要望・不具合スレに**運営ステータス**（受付 / 検討中 / 対応予定 / 実装済み / 今回は見送り）。**この機能が掲示板の心臓**で、「言えば直る」が目に見えることだけが次の投稿を呼ぶ。`実装済み` にはリリース版を添える＝掲示板がそのまま変更履歴のショーケースになる。 |
| **D-BOARD-POLL** | アンケートはスレに 1 つまで（選択肢 8 まで・締切必須）。1 アカウント 1 票で、**投票するまで結果を見せない**（先に見せると票が引っ張られる）。運営が「次に作るならどれか」を聞く器。 |
| **D-BOARD-DELETE** | 削除は論理削除（`deleted_at`）で、表示は「この投稿は削除されました」。**返信が付いたスレは本文だけ削除**し、返信は残す（スレ主の削除で他人の発言を巻き添えにしない）。返信 0 のスレだけ丸ごと消せる。完全削除は運営の purge に限る。 |
| **D-BOARD-NOIMAGE** | **画像アップロードは作らない。R2 は使わない。** 無断転載・生成画像の権利・わいせつ物の判断を、個人事業の運営が即応で回すのは現実的でない。放置した 1 枚が刑事責任に触れうる点で、テキストとはリスクの質が違う。 |
| **D-BOARD-LINK** | **外部リンクは貼れる。** 本文中の裸の URL を自動リンクにし、OGP カードで展開する。取得と表示の規則は §3。 |
| **D-BOARD-OGPCACHE** | OGP は**投稿時に 1 回だけ取得**して D1 にキャッシュする（`board_links`）。閲覧のたびに外部へ取りにいかない＝閲覧者の数だけ相手サイトを叩く事故を構造的に防ぐ。失敗も negative cache に入れる。 |
| **D-BOARD-OGPIMG** | **`og:image` は自前で保存せず、画像ホストが許可表にあるときだけ直リンクで表示**する。許可表の外はタイトル＋説明＋ドメインの**テキストカード**に落とす。任意のドメインの画像を出すと、投稿後に相手が中身を差し替える「後出し」を止められない（＝D-BOARD-NOIMAGE を裏口から破ることになる）。 |
| **D-BOARD-WORKCARD** | grove の公開作品 URL は、汎用 OGP ではなく**専用の作品カード**（表紙・タイトル・あらすじ・作者）で展開する。自サイトの、作者登録とモデレーションを通った自分の作品なので、画像を出しても権利関係が最初から片付いている。宣伝スレで本当に欲しいのはこれ。 |
| **D-BOARD-NODM** | **DM（個人間の直接連絡）は作らない。** 年齢確認できない利用者同士を 1 対 1 でつなぐと運営責任が跳ね上がる（利用規約 第3条・未成年者の利用と噛み合わない）。交流は公開の場だけに閉じる。 |
| **D-BOARD-FORM** | Google フォームは**残す**。記名式にすると辛口の声が確実に減るので、非公開の受け皿を併存させる。ヘルプページは「みんなで話す＝掲示板／個別に伝える＝フォーム」の 2 択にする。 |
| **D-BOARD-RATE** | レート制限は既存 `checkRateLimit`（`functions/api/_lib/rate-limit.ts`）を流用するが、**キーは `board:${userId}`** にする。あの表は `user_id` が主キーの 1 行で同期の 60 req/min を数えているので、素で渡すと掲示板の投稿が同期の枠を食う。スキーマ変更は要らない。 |
| **D-BOARD-REPORT** | 通報は運営の作業キューに積むだけで、**件数による自動非表示はしない**（結託通報で正常な投稿を落とせてしまう）。運営は 1 日 1 回キューを見て、非表示・投稿禁止を手で打つ。 |

## 2. 画面と導線

ルートは `#/board`（`src/ui/hooks/use-hash-route.ts` に追加）。**ログインなしでも読める**。
書き込みだけログインを要求する＝ grove の読者が覗いて、書きたくなったら無料登録できる。

一覧の既定の並びは **最終書き込み順**。種別で絞り込め、目安箱スレだけ先頭に固定（`pinned`）。
「新着順」にすると立てたきり動かないスレが上に残り、止まって見える。

**呼び水スレ（運営が先に立てておく 6 本）**

| 種別 | タイトル案 |
|---|---|
| `suggestion` | 目安箱 — ひとことで、何でもどうぞ |
| `bug` | うまく動かないところ |
| `intro` | はじめまして（自己紹介） |
| `chat` | いま書いている作品の進捗 |
| `promo` | 作品を紹介する・読み合う |
| `request` | 次に作る機能を決めるアンケート（poll つき） |

初回投稿の直前に表示名の設定ダイアログを挟む（`board_profiles` が無ければ 409 → ダイアログ）。
返信に気づく手段は「自分の書き込み」タブの未読バッジで足りる。**未読の基準（最後に見た時刻）は
`localStorage` に置く**ので、D1 に既読テーブルは要らない。メール通知は当面作らない。

## 3. 外部リンクと OGP — いちばん危ないところ

サーバーが利用者の指定した URL を取りに行く機能なので、素朴に書くと SSRF と踏み台になる。
**取得（サーバー）と表示（クライアント）を別々に絞る。**

### 3.1 取得の規則（`functions/api/board/link.ts`）

投稿を保存する処理の中で、本文から URL を抜き、キャッシュに無いものだけ取りに行く。

- **`https:` のみ**。ホストが IP リテラルのもの、既定以外のポート、自オリジン（`cotonoha-leaf.org` /
  `*.pages.dev` / `localhost`）は取得しない。
- リダイレクトは `redirect: 'manual'` で最大 3 回、**毎回同じ検査をやり直す**（初回だけ検査すると
  リダイレクトで内側へ飛ばされる）。
- タイムアウト 3 秒（`AbortSignal.timeout`）。`content-type` が `text/html` 以外は捨てる。
- 本文はストリームで読み、**256 KB か `</head>` で打ち切る**。全体を `text()` しない。
- 1 投稿あたり取得するのは先頭 2 本まで。3 本目以降はリンクにするだけでカードを作らない。
- 取れたら `board_links` に 7 日 TTL で入れる。失敗（404・タイムアウト・拒否）も
  `kind='none'` で 1 時間だけ入れる＝壊れた URL の連打で毎回取りに行かない。

### 3.2 表示の規則（`src/ui/components/BoardPage/link-card.tsx`）

- リンクは `target="_blank"` ＋ `rel="nofollow ugc noopener noreferrer"`。
- **カードには必ずドメインを出す。** リンクの見た目と飛び先が食い違う状態を作らない。
  本文の記法にリンク構文（`[表示](url)`）は入れない — 幸い既存の `markdownToHtml` は
  リンク記法を持っていないので、**自動リンクだけを足せばよい**。
- 画像を出すのは `og:image` の**ホストが許可表にあるとき**だけ（`OGP_IMAGE_HOSTS`）。
  照合はドット境界での接尾辞一致（`evil-twimg.com` が `twimg.com` に当たらないように）。
  表は `src/core/board/link.ts` の定数 1 箇所にまとめ、実装時に実際のレスポンスを見て
  主要サイト（grove・X・YouTube・note・カクヨム・小説家になろう・pixiv・GitHub）の
  画像ホストを埋める。**要望が来たらドメインを足す運用**にする。
- 画像は `loading="lazy"` ＋ `referrerpolicy="no-referrer"` ＋ 固定の縦横比枠。
- 運営は `board_links.blocked_at` で URL 単位でカードを潰せる（投稿は残したまま）。

> いま `public/` に CSP は置いていない。後で入れるなら、許可表のホストを `img-src` にも
> 反映する必要がある（2 箇所に同じ表が散らないよう、生成元は定数 1 つに保つ）。

## 4. スキーマ（`migrations/0008_board.sql`）

**すべて新規テーブル。既存の同期・課金・訪問者データには一切触らない**（後方互換性の観点では
もっとも安全な追加）。時刻はすべて epoch ms。論理削除は `0 = 生きている`。

| テーブル | 中身 |
|---|---|
| `board_profiles` | `user_id`(PK) / `display_name` / `name_key`(UNIQUE・正規化名) / `role`(`member`\|`staff`) / `banned_until` / `created_at` / `updated_at` |
| `board_threads` | `id`(PK) / `kind` / `title` / `user_id` / `status` / `status_note` / `shipped_version` / `pinned` / `locked` / `reply_count` / `like_count` / `created_at` / `bumped_at` / `deleted_at` / `hidden_at` |
| `board_posts` | `id`(PK) / `thread_id` / `seq`(スレ内連番・**1 番がスレ本文**) / `user_id` / `body` / `reply_to`(返信先 seq・0 = なし) / `created_at` / `deleted_at` / `hidden_at` |
| `board_likes` | `(thread_id, user_id)`(PK) / `created_at` |
| `board_polls` | `thread_id`(PK) / `question` / `options`(JSON 配列) / `multiple` / `closes_at` / `created_at` |
| `board_votes` | `(thread_id, user_id)`(PK) / `choices`(JSON 配列) / `created_at` |
| `board_reports` | `id`(PK) / `post_id` / `user_id`(通報者) / `reason` / `created_at` / `handled_at` |
| `board_links` | `url_key`(PK・正規化 URL の SHA-256 先頭 32 桁) / `url` / `host` / `kind`(`ogp`\|`work`\|`none`) / `title` / `description` / `image_url` / `image_ok` / `site_name` / `fetched_at` / `expires_at` / `blocked_at` |

索引は `board_threads (bumped_at DESC)` と `(kind, bumped_at DESC)`、
`board_posts (thread_id, seq)` UNIQUE と `(user_id, created_at DESC)`、
`board_reports (handled_at, created_at)`。

**スレ本文を `board_posts` の `seq=1` に置く**のが要点。本文と返信で削除の意味づけが揃い、
通報も投稿禁止も 1 つの経路で済む。

読み書きの量は無料枠の内側に収まる。D1 は 500 万行読み取り/日・10 万行書き込み/日で、
1 日 100 投稿・1000 閲覧なら桁が 2 つ余る（索引ぶんの書き込みを数えても同じ）。

## 5. API（`functions/api/board/`）

| エンドポイント | 責務 |
|---|---|
| `GET /api/board/threads` | 一覧（`kind` / `cursor`）。未ログインでも読める |
| `POST /api/board/threads` | スレ立て（本文＋任意で poll）。リンク取得もここで走る |
| `GET /api/board/threads/:id` | スレ 1 本（投稿・poll・リンクカードを同梱） |
| `PATCH /api/board/threads/:id` | ステータス／ピン／ロック（**staff のみ**） |
| `DELETE /api/board/threads/:id` | 自分のスレ（返信 0 のときだけ丸ごと・それ以外は本文だけ） |
| `POST /api/board/threads/:id/posts` | 返信 |
| `DELETE /api/board/posts/:id` | 自分の投稿 |
| `POST /api/board/threads/:id/like` | 👍 トグル（`request` / `bug` のみ） |
| `POST /api/board/threads/:id/vote` | 投票（1 アカウント 1 票・締切後は 409） |
| `POST /api/board/reports` | 通報 |
| `GET /PUT /api/board/me` | 自分の表示名・自分の投稿一覧 |
| `POST /api/board/moderate` | 非表示・投稿禁止（**staff のみ**） |

`staff` は最初のうち `board_profiles.role` を SQL で 1 行更新して付ける（管理画面は作らない）。

## 6. コードの置き場

規約どおり、判断できるものは全部 `src/core/` に置いてテストで固める。

- `src/core/board/types.ts` — Zod スキーマ（`BoardThread` `BoardPost` `BoardPoll` `LinkCard`）
- `src/core/board/name.ts` — 表示名の正規化・予約語・長さ
- `src/core/board/link.ts` — URL の正規化と取得可否の判定、OGP メタの抽出、`OGP_IMAGE_HOSTS`
- `src/core/board/render.ts` — **掲示板用の描画**。`markdownToHtml` をそのまま使わない
  （あれは `parseInlines` へ委譲していて `[[用語]]`・ルビが生きるが、掲示板に用語の解決先はない）。
  ブロック解釈は流用し、行内は「エスケープ＋強調＋自動リンク」だけに絞る
- `src/core/board/poll.ts` — 集計と開示判定
- `src/core/board/permission.ts` — 誰が何を消せる／変えられるか
- `functions/api/board/*.ts` ＋ `functions/api/_lib/board-*.ts`
- `src/ui/_api/board.ts` / `src/ui/components/BoardPage/`
- `src/ui/Root.tsx` にルート、`src/ui/components/SideNav/side-nav.tsx` に導線

## 7. 不変条件（テストで担保）

1. 未ログインの書き込み系は 401。読み取りは 200。
2. 表示名が未設定のまま投稿すると 409（設定ダイアログへ誘導）。
3. 予約語・正規化後に重複する表示名は 409。
4. 自分以外の投稿・スレは削除できない（403）。staff は非表示にできるが削除はしない。
5. **返信のあるスレを削除すると、本文だけ消えて返信は残る。**
6. 削除・非表示の投稿は、一覧でも詳細でも本文を返さない（伏字を返す）。
7. アンケートは投票前に票数を返さない。締切後の投票は 409。1 アカウント 1 票。
8. OGP 取得は `https:` 以外・IP リテラル・非標準ポート・自オリジンを拒否し、
   **リダイレクト先も毎回同じ検査を通る**。
9. `og:image` のホストが許可表に無ければ `image_url` は空で返る。
   接尾辞一致はドット境界でのみ成立する。
10. 本文の描画で HTML は必ずエスケープされ、`[[用語]]`・ルビは効かず、裸の URL は
    `rel="nofollow ugc noopener noreferrer"` 付きのリンクになる。
11. レート制限のキーが `board:` 接頭辞で、同期のカウンタと混ざらない。

## 8. コードの外の宿題（実装より先に片付ける）

- **利用規約**（`public/terms.html`）に投稿コンテンツの条項が 1 つも無い。第6条（禁止事項）の
  あとに、投稿の権利は投稿者に残ること・運営がサービス上で利用できること・違反投稿を削除
  および非表示にできること・発信者情報開示請求への対応、を足す。
- **プライバシーポリシー**（`public/privacy.html`）に、掲示板の投稿内容と `user_id` を保管する旨。
- **掲示板ガイドライン**を 1 ページ（特定の作品・作者への評価はしない／個人情報と連絡先を
  書かない／宣伝は宣伝スレで）。文言は `toc-copy` スキルで書く。
- 運営アカウントに `role='staff'` を入れる手順を `docs/requirement/05-sync-setup.md` と
  同じ調子で残す。

**順序を守る。規約を直してから機能を出す。**

## 9. 積み残し

- 全文検索。当面は `LIKE` で足りる。件数が増えたら考える。
- 目安箱の一言を要望スレへ「昇格」させる運営操作。最初は手でスレを立て直せばよい。
- 返信のメール通知。未読バッジで足りなかったら考える。
- 画像の投稿。D-BOARD-NOIMAGE の判断を覆すときは、有料会員のみ・1 日 3 枚・90 日で自動削除・
  EXIF 除去のうえ再エンコード・通報で即自動非表示、をまとめて入れる前提とする。
