# x-tutorial

コトノハ-leaf- の機能紹介動画（1 機能＝1 本・字幕つき）を録って X に投稿する道具。
アプリ本体とは独立していて、CI・ビルド・lint・typecheck の対象外。依存はルートの
`@playwright/test` と、実行環境の `ffmpeg` だけ（X API のクライアントは自前）。
毎日の回し方（Claude Code のルーティン）は `.claude/skills/x-daily-post/`。

## 使い方

```bash
node tools/x-tutorial/record.ts --list                 # 台本の一覧
node tools/x-tutorial/record.ts ruby-dots              # 指定の台本を録る
node tools/x-tutorial/record.ts --today                # 今日（日本時間）の順番の台本を録る
node tools/x-tutorial/record.ts tools/x-tutorial/scenarios/<id>.ts   # 並びに入れる前の台本を試し撮り
node tools/x-tutorial/post.ts out/<id>.mp4 out/<id>.post.txt          # 試運転（送らない）
node tools/x-tutorial/post.ts out/<id>.mp4 out/<id>.post.txt --live   # 投稿する
node tools/x-tutorial/post.ts --whoami                 # 認証の確認
node --test tools/x-tutorial/lib/x-client.test.ts      # 署名・文字数のテスト
```

Node 22.18 以降（`.ts` をそのまま実行する）と `ffmpeg`（H.264 が使えるもの）が要る。
アプリが `http://localhost:5173` で動いていなければ、`record.ts` がゲストモードで起動して終わったら止める。

出力は `tools/x-tutorial/out/`（git 管理外）：`<id>.mp4`・`<id>.post.txt`・`<id>-frames/`（確認用のコマ）。

## しくみ

| 工程 | 中身 |
|---|---|
| 録画 | Playwright 1.59+ の `page.screencast`。1024×576 の PC レイアウトで録り、1280×720 に拡大する（スマホで見ても字が読める大きさ） |
| 字幕 | ページに固定配置の要素（閉じた Shadow DOM）を差し込んで焼き込む。フォントはアプリ同梱の Noto Sans JP。差し込めなければ録画ごと止まる（`screencast.showOverlay` は失敗を黙って流すので使わない） |
| 撮る人 | 既定はゲスト。構想の道具（プロット・アウトライン・相関図・マインドマップ）は無料登録で出る機能なので、台本に `as: 'free'` と書くと、開発サーバが配る `auth-context.ts` のゲスト既定を録画中だけ `free` に差し替えて撮る（ログイン UI は出ない・アプリのコードは変えない） |
| 下ごしらえ | 台本の `setup` は録画の前に走る（作品や話を作っておく等・動画に映らない）。共通の操作は `lib/app.ts` |
| 変換 | ffmpeg で H.264 / yuv420p / 30fps / 無音 AAC の mp4 に |
| 投稿 | X API v2：`/2/media/upload/initialize → append → finalize → 状態確認` → `/2/tweets`。v2 が OAuth 1.0a を拒んだら v1.1（`upload.x.com`）に切り替える |
| 順番 | `scenarios/index.ts` の並びを、周回の初日（環境変数 `X_ROTATION_START`＝`YYYY-MM-DD`・既定 2026-01-01）からの経過日数で回す。初日に先頭が出る（状態を持たない） |

## X 側の準備

1. X Developer Console でアプリを作り、権限を **Read and write** にする
2. 投稿する垢で **Access Token and Secret** を発行する（OAuth 1.0a・期限なし）
3. 従量課金のクレジットを買い、使用上限を決めておく（2026-09 時点：投稿 $0.015／URL 入り $0.20）
4. 実行環境の環境変数に `X_API_KEY` `X_API_SECRET` `X_ACCESS_TOKEN` `X_ACCESS_TOKEN_SECRET`、
   ネットワークの許可に `api.x.com` `upload.x.com`
5. `post.ts --whoami` で垢名が返れば準備完了。本番投稿を始めるときに `X_POST_LIVE=1` を足し、
   `X_ROTATION_START` に初日の日付を入れる（その日に並びの先頭「ルビと傍点」が出る）
