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
| **D-BOARD-KIND** | スレに**種別**を持たせる（`request` 要望 / `bug` 不具合 / `chat` 雑談 / `intro` 自己紹介 / `promo` 作品紹介 / `notice` お知らせ）。**旧 `suggestion`（目安箱）は `request` へ統合した**。「ひとことの受け皿＝目安箱／まとまった起票＝要望」と書き分けたが、画面ではどちらも「運営に伝える」で、どちらへ書くかの判断が利用者の負担にしかなっていなかった。**ただし `BOARD_KINDS` からは消さない。** 本番と STG の `board_threads.kind` には `suggestion` の行がそのまま残っており、enum から外すと `BoardThreadSchema.parse` が落ちて**その 1 件どころか一覧ごと読めなくなる**（CLAUDE.md「後方互換性」）。残したうえで、表示は `boardKindLabel`（＝「要望」）、絞り込みは `kindsForFilter` で `request` に合流させ、新規作成は `CREATABLE_KINDS` から外す（`src/core/board/types.ts`）。**`KINDS_WITH_STATUS` にも `suggestion` を残す**＝統合前の目安箱スレに運営が付けたステータスと、一覧に出る賛同数を画面から消さない。不具合は要望と分けたまま（再現手順という要望には無い情報が要り、優先度の付け方も「実装済み」の意味も違う）。代わりに種別ごとの一言（`boardKindHint`）を選ぶ画面に添えて、どちらへ書くかで迷わせない。 |
| **D-BOARD-LIKEPOST** | **👍 はスレッドではなく書き込み 1 件ごとに付く**（`board_post_likes`・migrations/0009）。当初はスレッドに 1 アカウント 1 回で、画面でも見出しに大きなボタンが 1 つ乗っていた。実際に読み返すと、賛同したいのは「このスレッド」ではなく**その中の 1 つの書き込み**（「これに困っている」「この案がいい」）で、見出しのボタンではどの意見に票が入ったのか誰にも分からない。**種別でも絞らない**（0009 以前は `request` / `bug` だけ）＝雑談や作品紹介の書き込みにも押せる。種別で押せる・押せないを分けると「なぜこのスレでは押せないのか」を画面で説明し続けることになる。**`board_threads.like_count` は残し、意味を「スレ本文（seq=1）に付いた 👍」に読み替える**＝一覧の賛同数（要望・不具合）はそのまま使え、旧 `board_likes` の行も本文への 👍 として引き継げる（表示先が消えない・CLAUDE.md「後方互換性」）。**旧 `board_likes` テーブルは消さない**（退避と突き合わせのため）。API は `POST /api/board/like?post=` だが、端末に残った古い JS のために `?thread=` も受け、本文への 👍 に写す。 |
| **D-BOARD-NOTICE** | **`notice`（お知らせ）は運営だけが書ける。スレ立ても返信も。** 判定は `canCreateThread` と `canPost`（`src/core/board/permission.ts`・`STAFF_ONLY_KINDS`）が両方見て、member は 403。返信を許すと、運営の告知にぶら下がった会話が本文と同じ場所に並び、**読めば分かる連絡だったものが読み解く対象になる**。話したいことには要望・不具合・雑談の器がある。画面は運営以外に**返信欄そのものを出さない**（「書き込めません」の断りも出さない＝押せないボタンや断り書きが並ぶより、最初から無いほうが読みやすい）。運営ステータスも付けない（`KINDS_WITH_STATUS` に入れない）。書き込みへの 👍 だけは付く（D-BOARD-LIKEPOST）。一覧では塗りつぶしのチップと行の色（`KIND_UI.notice.rowClassName`）で目立たせる。スレを立てる画面には**選択肢そのものを立場で出し分ける**（`creatableKindOrder(role)`）＝押させてから 403 で断らない。 |
| **D-BOARD-STATUS** | 要望・不具合スレに**運営ステータス**（受付 / 検討中 / 対応予定 / 実装済み / 今回は見送り）。**この機能が掲示板の心臓**で、「言えば直る」が目に見えることだけが次の投稿を呼ぶ。`実装済み` にはリリース版を添える＝掲示板がそのまま変更履歴のショーケースになる。 |
| **D-BOARD-POLL** | アンケートはスレに 1 つまで（選択肢 8 まで・締切必須）。1 アカウント 1 票で、**投票するまで結果を見せない**（先に見せると票が引っ張られる）。運営が「次に作るならどれか」を聞く器。 |
| **D-BOARD-DELETE** | 削除は論理削除（`deleted_at`）で、表示は「この投稿は削除されました」。**返信が付いたスレは本文だけ削除**し、返信は残す（スレ主の削除で他人の発言を巻き添えにしない）。丸ごと消せるのは**返信が 1 件も「行として」無いスレだけ**で、削除済み・運営が非表示にした返信も「有る」に数える。生きている返信の数（`reply_count`）で判定してはいけない — 運営が返信を非表示にすると 0 に戻り、スレ主の削除が他人の投稿にまで `deleted_at` を刻んで、**運営の判断で伏せたものが本人の意思で消したものに化ける**（`unhide` しても戻らない）。完全削除は運営の purge に限る。 |
| **D-BOARD-NOIMAGE** | **画像アップロードは作らない。R2 は使わない。** 無断転載・生成画像の権利・わいせつ物の判断を、個人事業の運営が即応で回すのは現実的でない。放置した 1 枚が刑事責任に触れうる点で、テキストとはリスクの質が違う。 |
| **D-BOARD-LINK** | **外部リンクは貼れる。** 本文中の裸の URL を自動リンクにし、OGP カードで展開する。取得と表示の規則は §3。 |
| **D-BOARD-OGPCACHE** | OGP は**投稿時に 1 回だけ取得**して D1 にキャッシュする（`board_links`）。閲覧のたびに外部へ取りにいかない＝閲覧者の数だけ相手サイトを叩く事故を構造的に防ぐ。失敗も negative cache に入れる。 |
| **D-BOARD-OGPIMG** | **`og:image` は自前で保存せず、画像ホストが許可表にあるときだけ直リンクで表示**する。許可表の外はタイトル＋説明＋ドメインの**テキストカード**に落とす。任意のドメインの画像を出すと、投稿後に相手が中身を差し替える「後出し」を止められない（＝D-BOARD-NOIMAGE を裏口から破ることになる）。 |
| **D-BOARD-WORKCARD** | grove の公開作品 URL は、汎用 OGP ではなく**専用の作品カード**（表紙・タイトル・あらすじ・作者）で展開する。自サイトの、作者登録とモデレーションを通った自分の作品なので、画像を出しても権利関係が最初から片付いている。宣伝スレで本当に欲しいのはこれ。 |
| **D-BOARD-NODM** | **DM（個人間の直接連絡）は作らない。** 年齢確認できない利用者同士を 1 対 1 でつなぐと運営責任が跳ね上がる（利用規約 第3条・未成年者の利用と噛み合わない）。交流は公開の場だけに閉じる。 |
| **D-BOARD-FORM** | Google フォームは**残す**。記名式にすると辛口の声が確実に減るので、非公開の受け皿を併存させる。ヘルプページは「みんなで話す＝掲示板／個別に伝える＝フォーム」の 2 択にする。 |
| **D-BOARD-RATE** | レート制限は**二段構え**にする。(1) 設計の上限（投稿 10 件/時・スレ 3 本/日）は D1 の行を数えて判定する（`countPostsSince` / `countThreadsSince`。削除済みも数える＝消して書き直す抜け道を作らない）。(2) 連打と自動化を止める**分あたりの安全弁**は既存 `checkRateLimit`（`functions/api/_lib/rate-limit.ts`）を流用し、**キーは `board:${userId}`** にする。あの表は `user_id` が主キーの 1 行で同期の 60 req/min を数えているので、素で渡すと掲示板の投稿が同期の枠を食う。スキーマ変更は要らない。**`checkRateLimit` の窓は 60 秒なので、そこへ「10 件/時」の値を渡してはいけない**（10 件/分＝600 件/時になり、設計の 60 倍緩む）。安全弁は掲示板の全操作が同じ 1 行を共有するため、操作ごとに違う値を渡さず一律 60/分にする（👍 だけ 10 にすると、一覧で 10 回押した人がその 1 分間まったく書けなくなる）。**この数値を変えるときは `public/board-guidelines.html` も直す**。ガイドラインに「スレッドは1日に3本まで、書き込みは1時間に10件まで」と数字を書いて公表しているので、実装値だけ動かすと案内が嘘になる。 |
| **D-BOARD-BODYLEN** | **1 投稿の本文は 1500 字まで**（`BOARD_LIMITS.body`。4000 字から下げた）。掲示板は一覧とスレを行き来しながら拾い読みする器で、1 投稿がそこまで長いと読む側が先に疲れる。1500 字なら原稿用紙 4 枚弱で、スマホでも数回スクロールすれば読み切れる。書き切れないぶんは返信で足せばよく、上限が決めるのは「1 回の書き込みの長さ」だけ。**効かせるのは入力スキーマ（`CreateThreadInputSchema` / `CreatePostInputSchema`）だけ**にする。保存済みを読む `BoardPostSchema.body` に max を付けると、4000 字時代に書かれた投稿が parse で落ちて**そのスレが丸ごと開けなくなる**（CLAUDE.md「後方互換性」）。**この数値も `public/board-guidelines.html` に書いてある**ので、動かすときは一緒に直す（D-BOARD-RATE と同じ）。 |
| **D-BOARD-REPORT** | 通報は運営の作業キューに積むだけで、**件数による自動非表示はしない**（結託通報で正常な投稿を落とせてしまう）。運営は 1 日 1 回キューを見て、非表示・投稿禁止を手で打つ。 |
| **D-BOARD-ACCOUNTDEL** | アカウント削除（purge）でも**掲示板の投稿は消さない**。`board_profiles` の行は残して `deleted_at` を立て、表示名を「退会したユーザー」（`board-store.ts` の `RETIRED_AUTHOR_NAME`）に伏せる。投稿まで消すと、返信の付いた会話が虫食いになって残った人の発言が読めなくなる。**`name_key` も残す**＝退会した人の名前を後から別人が名乗れない（なりすまし防止）。実装は `functions/api/_lib/purge.ts`。利用規約 第6条の2 と揃っている。 |

## 2. 画面と導線

ルートは `#/board`（`src/ui/hooks/use-hash-route.ts` に追加）。**ログインなしでも読める**。
書き込みだけログインを要求する＝ grove の読者が覗いて、書きたくなったら無料登録できる。

一覧の既定の並びは **最終書き込み順**。種別で絞り込め、お知らせスレだけ先頭に固定（`pinned`）。
「新着順」にすると立てたきり動かないスレが上に残り、止まって見える。

**呼び水スレ（運営が先に立てておく 6 本）**

| 種別 | タイトル案 |
|---|---|
| `notice` | 掲示板をはじめました（使い方とガイドライン） |
| `request` | 次に作る機能を決めるアンケート（poll つき） |
| `bug` | うまく動かないところ |
| `chat` | いま書いている作品の進捗 |
| `intro` | はじめまして（自己紹介） |
| `promo` | 作品を紹介する・読み合う |

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

## 4. スキーマ（`migrations/0008_board.sql` ＋ `0009_board_post_likes.sql`）

**すべて新規テーブル。既存の同期・課金・訪問者データには一切触らない**（後方互換性の観点では
もっとも安全な追加）。時刻はすべて epoch ms。論理削除は `0 = 生きている`。

| テーブル | 中身 |
|---|---|
| `board_profiles` | `user_id`(PK) / `display_name` / `name_key`(UNIQUE・正規化名) / `role`(`member`\|`staff`) / `banned_until` / `deleted_at`(退会＝D-BOARD-ACCOUNTDEL) / `created_at` / `updated_at` |
| `board_threads` | `id`(PK) / `kind` / `title` / `user_id` / `status` / `status_note` / `shipped_version` / `pinned` / `locked` / `reply_count` / `like_count` / `created_at` / `bumped_at` / `deleted_at` / `hidden_at` |
| `board_posts` | `id`(PK) / `thread_id` / `seq`(スレ内連番・**1 番がスレ本文**) / `user_id` / `body` / `reply_to`(返信先 seq・0 = なし) / `created_at` / `deleted_at` / `hidden_at` / `like_count`(0009) |
| `board_post_likes` | `(post_id, user_id)`(PK) / `created_at`。**👍 は書き込みごと**（0009・D-BOARD-LIKEPOST） |
| `board_likes` | `(thread_id, user_id)`(PK) / `created_at`。**0009 で用済み**（本文への 👍 に引き継ぎ済み）。読み書きはもう無いが、退避のため行は残す |
| `board_polls` | `thread_id`(PK) / `question` / `options`(JSON 配列) / `multiple` / `closes_at` / `created_at` |
| `board_votes` | `(thread_id, user_id)`(PK) / `choices`(JSON 配列) / `created_at` |
| `board_reports` | `id`(PK) / `post_id` / `user_id`(通報者) / `reason` / `created_at` / `handled_at` |
| `board_links` | `url_key`(PK・正規化 URL の SHA-256 先頭 32 桁) / `url` / `host` / `kind`(`ogp`\|`work`\|`none`) / `title` / `description` / `image_url` / `image_ok` / `site_name` / `fetched_at` / `expires_at` / `blocked_at` |
| `board_post_links` | `(post_id, url_key)`(PK) / `ord`(本文での出現順)。投稿とリンクカードの対応表。詳細の取得はこれを JOIN するだけで、閲覧時に本文を解析し直さない |

索引は `board_threads (bumped_at DESC)` と `(kind, bumped_at DESC)`、
`board_posts (thread_id, seq)` UNIQUE と `(user_id, created_at DESC)`、
`board_reports (handled_at, created_at)`、`board_post_links (post_id, ord)`。

**`board_posts` に IP アドレスの列を作らない。** `public/privacy.html` で
「掲示板の投稿について投稿時の IP アドレスは記録していません」と公表した時点で、これは
利用者との契約になった。開示請求への回答（「通信の記録にあたる情報は保有していない」）も
この一文に乗っている。荒らし対策で後から足したくなる欄だが、足した瞬間に公表内容が嘘になり、
保有した以上は開示請求の対象にもなる。**足すならプライバシーポリシーの改定が先**で、
順序を逆にしない。荒らしは `user_id`（記名式・D-BOARD-SIGNED）を鍵に投稿禁止で止める。

**スレ本文を `board_posts` の `seq=1` に置く**のが要点。本文と返信で削除の意味づけが揃い、
通報も投稿禁止も 1 つの経路で済む。

読み書きの量は無料枠の内側に収まる。D1 は 500 万行読み取り/日・10 万行書き込み/日で、
1 日 100 投稿・1000 閲覧なら桁が 2 つ余る（索引ぶんの書き込みを数えても同じ）。

## 5. API（`functions/api/board/`）

**対象はパスではなくクエリで指す。** Pages Functions のファイルルーティングに動的セグメント
（`[id].ts`）を持ち込まず、`functions/api/board/` を 8 ファイル・1 階層に保つ。読む側の覚え方は
**「対象そのものは `id`、親スレの指定は `thread`」** の 1 つだけで、エラーコードも
`missing_id` / `missing_thread` がこれに対応する。

| エンドポイント | 責務 |
|---|---|
| `GET /api/board/threads?kind=&cursor=` | 一覧。`{ threads, nextCursor }` を返す。未ログインでも読める |
| `POST /api/board/threads` | スレ立て（本文＋任意で poll）。リンク取得もここで走る。**`pinned` は必ず 0**（ピン留めは staff の PATCH で後付け・§8.2） |
| `GET /api/board/thread?id=` | スレ 1 本（`{ thread, posts, poll, canPost }`）。未ログインでも読める |
| `PATCH /api/board/thread?id=` | ステータス／ピン／ロック（**staff のみ**）。更新後のスレを読み直して返す |
| `DELETE /api/board/thread?id=` | 自分のスレ（返信が 1 件も無いときだけ丸ごと・それ以外は本文だけ） |
| `POST /api/board/posts?thread=` | 返信 |
| `DELETE /api/board/posts?id=` | 自分の投稿 |
| `POST /api/board/like?post=` | 👍 トグル（書き込み 1 件ごと・種別は問わない）。古い `?thread=` はスレ本文への 👍 に写す |
| `POST /api/board/vote?thread=` | 投票（1 アカウント 1 票・締切後は 409） |
| `POST /api/board/reports` | 通報（本文で `postId` を指す） |
| `GET /PUT /api/board/me` | 自分の表示名・自分の投稿一覧（`BoardMeResponse`） |
| `POST /api/board/moderate` | 投稿とスレの非表示・投稿禁止・リンク遮断（**staff のみ**） |

レスポンスの型は `src/core/board/types.ts` に置く（`ThreadListResponse` / `BoardMeResponse` /
`MyBoardPost` ほか）。**画面から `functions/` を import しない**＝ workers-types が `src/` に混ざる。

`POST /api/board/moderate` の `action` は `hide_post` / `unhide_post` / `hide_thread` /
`unhide_thread` / `ban_user` / `unban_user` / `block_link`。**スレ単位の非表示が要る**のは、
本文（seq=1）を伏せてもタイトルは `board_threads.title` に残り、一覧にも詳細にも出続けるため。
タイトルは利用者が自由に書ける欄なので、ここを下ろせないと誹謗中傷や個人情報に対する
運営の最後の手段が D1 への直接 UPDATE しか残らない。

`ban_user` の対象は `userId` か `postId` のどちらかで指す。**どのレスポンスも `user_id` を
返さない**（誰が書いたかを Clerk の ID で漏らさない）ので、画面から荒らしを止める導線は
「その投稿の id を渡す」しか作れない。サーバが投稿から投稿者を引き、応答にも `user_id` は
載せない。自分自身への ban は `postId` 経由でも拒否する。

すべてのレスポンスに `Cache-Control: private, no-store` を付ける。`mine` / `liked` / `canPost` は
閲覧者ごとに違うので、あとから CDN や `public/_headers` でキャッシュを足したときに
他人の状態が配られてはいけない。

`staff` は `board_profiles.role` を SQL で 1 行更新して付ける（管理画面は作らない。手順は §8）。

## 6. コードの置き場

規約どおり、判断できるものは全部 `src/core/` に置いてテストで固める。

- `src/core/board/types.ts` — Zod スキーマ（`BoardThread` `BoardPost` `BoardPoll` `LinkCard`）
- `src/core/board/name.ts` — 表示名の正規化・予約語・長さ
- `src/core/board/link.ts` — URL の正規化と取得可否の判定、OGP メタの抽出、`OGP_IMAGE_HOSTS`
- `src/core/board/render.ts` — **掲示板用の描画**。`markdownToHtml` をそのまま使わない
  （あれは `parseInlines` へ委譲していて `[[用語]]`・ルビが生きるが、掲示板に用語の解決先はない）。
  ブロック解釈は流用し、行内は「エスケープ＋強調＋自動リンク」だけに絞る。
  **ブロック解釈を流用する以上、空行は空段落として残り、そのぶん行が空く。**
  `public/board-guidelines.html` のネタバレ配慮（「そのあと一行あけておくと、読むかどうかを
  相手が自分で選べます」）はこの挙動を前提に書いた案内なので、空行を畳む向きに変えない
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
   運営が非表示にした返信・削除済みの返信しか無いスレも「返信あり」に数える
   （スレ主の削除が他人の hidden 投稿に `deleted_at` を刻まない）。
6. 削除・非表示の投稿は、一覧でも詳細でも本文を返さない（伏字を返す）。
7. アンケートは投票前に票数を返さない。締切後の投票は 409。1 アカウント 1 票。
8. OGP 取得は `https:` 以外・IP リテラル・非標準ポート・自オリジンを拒否し、
   **リダイレクト先も毎回同じ検査を通る**。
9. `og:image` のホストが許可表に無ければ `image_url` は空で返る。
   接尾辞一致はドット境界でのみ成立する。
10. 本文の描画で HTML は必ずエスケープされ、`[[用語]]`・ルビは効かず、裸の URL は
    `rel="nofollow ugc noopener noreferrer"` 付きのリンクになる。
11. レート制限のキーが `board:` 接頭辞で、同期のカウンタと混ざらない。
12. **1 時間に 10 件を超えて投稿できない**（`too_many_posts` で 429）。
    削除した投稿も枠を使う＝消して書き直しても上限は戻らない。
    分あたりの安全弁は別枠で、こちらは 60 秒の窓を数える（値の意味を取り違えない）。
13. **投稿禁止中は 👍 も押せない**（403）。ロックされたスレには staff でも 👍 を足せない
    （409）。ロックは「この話は終わり」の意思表示なので、票だけ動くのは筋が通らない。
    伏せた書き込み（削除・非表示）にも押せない（404 `gone`）＝本文が読めないものに
    票だけ残らない。`like_count` は差分加算せず、押すたびに行を数え直して入れる。
14. 退会した利用者の投稿は残り、投稿者名だけが「退会したユーザー」になる。
    `name_key` は残るので、その名前を別人が名乗ろうとすると 409。

## 8. コードの外の宿題と運用手順

### 8.0 公開前に片付ける文書（済）

- **利用規約**（`public/terms.html`）に投稿コンテンツの条項が 1 つも無い。第6条（禁止事項）の
  あとに、投稿の権利は投稿者に残ること・運営がサービス上で利用できること・違反投稿を削除
  および非表示にできること・発信者情報開示請求への対応、を足す。→ 第6条の2 として追加済み。
- **プライバシーポリシー**（`public/privacy.html`）に、掲示板の投稿内容と `user_id` を保管する旨。
  → 追加済み。あわせて**投稿時の IP アドレスは記録しないと公表した**（§4 の注記が契約になる）。
- **掲示板ガイドライン**を 1 ページ（特定の作品・作者への評価はしない／個人情報と連絡先を
  書かない／宣伝は宣伝スレで）。文言は `toc-copy` スキルで書く。
  → `public/board-guidelines.html`。**レート制限の数値と、空行が段落になる挙動を書いてある**
  （D-BOARD-RATE・§6）。

**順序を守る。規約を直してから機能を出す。**

### 8.1 運営アカウントに `staff` を付ける

管理画面は作らない。最初のうちは D1 に SQL を 1 行打つ。`board_profiles` の行は
**初回の表示名設定でできる**ので、先に自分で掲示板に表示名を登録してから実行する
（行が無いと `UPDATE` は 0 件で静かに終わる）。

```
wrangler d1 execute <DB名> --remote \
  --command "UPDATE board_profiles SET role='staff', updated_at=<epoch ms> WHERE user_id='<Clerk の user_id>'"
```

`role` を戻すときは `'member'` を入れる。**`banned_until` や `deleted_at` を同じ文で触らない**
（1 欄の更新で他の欄を落とさない）。付いたかどうかは `GET /api/board/me` の `profile.role` で確かめる。

### 8.2 呼び水スレ 6 本を用意する

§2 の 6 本は運営が普通に投稿して作る。**`POST /api/board/threads` は誰が呼んでも
`pinned=0`** なので（スレ立てで自分を先頭に固定できてしまってはいけない）、
お知らせの先頭固定は**立てたあとに staff で `PATCH /api/board/thread?id=` して付ける**。

1. staff アカウントで表示名を登録する（8.1 より先）。
2. 6 本を `POST /api/board/threads` で立てる。`request` の 1 本には `poll` を添える。
   **`notice` は staff でないと 400/403 になる**（D-BOARD-NOTICE）ので、8.1 を先に済ませておく。
3. お知らせスレだけ `PATCH /api/board/thread?id=<id>` に `{"pinned":true}` を送る。
4. 一覧の先頭に来ていること、種別の絞り込みで 6 本が散ることを画面で確認する。

ステータス・ピン・ロックの staff 限定 UI は、この 6 本が無いと実機で確認できない。
**リリース前にステージングでも同じ 6 本を作る。**

### 8.3 非表示・投稿禁止・通報記録の purge

利用規約とプライバシーポリシーで「必要がなくなったと判断した時点で完全に削除します」と
約束しているので、**運営の判断で消す作業が定期的に要る**。当面は月 1 回、SQL で行う。

- **通報記録**（`board_reports`）… 処理済み（`handled_at != 0`）で、対応から十分に時間が
  経ったものを `DELETE`。未処理の行は残す。読む API はまだ無いので、キューを見るのも
  `wrangler d1 execute` で `WHERE handled_at = 0 ORDER BY created_at` を引く（§9）。
- **非表示にした投稿・スレ**（`hidden_at != 0`）… 争いが収まって復活の見込みが無いものを
  `DELETE`。**`unhide` で戻せなくなる**ので、消す前に戻す判断を先に確定させる。
- **投稿禁止**（`banned_until`）… 期限切れの行は放置してよい（過去の日時は判定に効かない）。
  恒久的に消すのは `deleted_at`（退会）の経路だけ。

**論理削除（`deleted_at`）の投稿を purge しない。** D-BOARD-DELETE のとおり本人の削除は
「この投稿は削除されました」の表示までが仕様で、行を消すと返信の番号が飛ぶ。

## 9. 積み残し

- **通報キューを読む API。** いまは書き込み専用で、運営は `wrangler d1 execute` で
  `board_reports` を直に引く（§8.3）。索引（`handled_at, created_at`）は用意してある。
  1 日 1 回の運用（D-BOARD-REPORT）が手で回らなくなったら、staff 限定の
  `GET /api/board/reports` と「処理済みにする」操作を足す。
- **レート制限の閾値が 2 か所に分かれている。** 時間あたりの上限（`postsPerHour` /
  `threadsPerDay`）は `src/core/board/types.ts` の `BOARD_LIMITS` にあるが、分あたりの
  安全弁（`BOARD_ACTIONS_PER_MINUTE`）は `functions/api/board/board-endpoint.ts` にある。
  画面が「あと何件書けるか」を出すようになったら `BOARD_LIMITS` へ寄せる。
  **どちらを動かすときも `public/board-guidelines.html` の数字と揃える**（D-BOARD-RATE）。
- **投稿数の判定は原子的でない。** `countPostsSince` / `countThreadsSince` と INSERT の間に
  隙間があるので、同時送信で 11 件目・4 本目が通りうる。「一晩で数千件」を止めるのが目的で、
  分あたりの安全弁と 2 枚で受けている。厳密にするなら D1 のトランザクションが要る。
- **名前解決で内部 IP を指すホスト**（`127.0.0.1.nip.io` のような形）は、IP リテラルにも
  内部 TLD にも当たらず §3.1 の検査を通る。Cloudflare Workers の egress は private range へ
  抜けにくいので実害は限定的だが、ホスト名のラベルに埋まった IPv4 パターンを拒否側へ足す。
- **`OGP_IMAGE_HOSTS` にカクヨム・小説家になろう・pixiv がまだ無い。** §3.2 の「実際の
  レスポンスを見て足す」運用どおりだが、宣伝スレ（`promo`）で真っ先に貼られる 3 サイトが
  当面テキストカードに落ちる。
- 全文検索。当面は `LIKE` で足りる。件数が増えたら考える。
- **旧 `suggestion` の行を `request` へ書き換える移行 SQL。** いまは表示・絞り込み・新規作成の
  3 か所で `request` に合流させているだけで、D1 の値は `suggestion` のまま残っている
  （消さないのが正解・D-BOARD-KIND）。読み替えの分岐を畳みたくなったら考える。
- 返信のメール通知。未読バッジで足りなかったら考える。
- 画像の投稿。D-BOARD-NOIMAGE の判断を覆すときは、有料会員のみ・1 日 3 枚・90 日で自動削除・
  EXIF 除去のうえ再エンコード・通報で即自動非表示、をまとめて入れる前提とする。
