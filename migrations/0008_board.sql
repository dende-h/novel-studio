-- 0008_board: 掲示板（記名式スレッド・目安箱・アンケート・外部リンクの OGP）。
-- 設計は docs/requirement/09-board.md。すべて新規テーブルで、既存の works / activity /
-- subscriptions / visitor_days には触れない＝同期・課金のデータに影響しない。
--
-- 共通の決めごと:
--   * 時刻はすべて epoch ms（Date.now()）の INTEGER。
--   * 論理削除は「0 = 生きている」。deleted_at / hidden_at に時刻が入ったら伏せる。
--     完全削除は運営の purge だけ（D-BOARD-DELETE）。
--   * 外部キー制約は付けない（既存テーブルと同じ流儀。D1 では既定で無効）。

-- 掲示板の表示名（D-BOARD-SIGNED / D-BOARD-NAME）。
-- 記名式なので、この行が無いと投稿できない。Clerk の userId 1 つにつき 1 行。
--   name_key    : 見た目が同じになる名前を畳んだ正規化キー（src/core/board/name.ts の nameKeyOf）。
--                 これに UNIQUE を張ることで、全角・大文字・空白の違いで運営を名乗る成りすましを防ぐ。
--   role        : 'member' | 'staff'。staff だけが非表示・投稿禁止・ステータス変更をできる。
--                 最初の staff は SQL で 1 行 UPDATE して付ける（管理画面は作らない）。
--   banned_until: 投稿禁止の期限。0 は禁止なし。
--   deleted_at  : 退会した時刻。0 以外なら表示名を伏せる（投稿そのものは残す）。
--                 返信のついた会話が虫食いにならないよう、行ごと消さずに伏せる。
CREATE TABLE IF NOT EXISTS board_profiles (
  user_id      TEXT    PRIMARY KEY,          -- Clerk userId
  display_name TEXT    NOT NULL,
  name_key     TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'member',
  banned_until INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 表示名の重複を DB で止める（アプリ側の判定をすり抜けた同時登録も弾ける）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_profiles_name ON board_profiles (name_key);

-- スレッド。本文は board_posts の seq=1 に置く（下の board_posts のコメント参照）。
--   status / status_note / shipped_version は運営ステータス（D-BOARD-STATUS）。
--     種別が request / bug のときだけ画面に出す。'' は「まだ付けていない」。
--   pinned      : 一覧の先頭に固定（目安箱スレ）。
--   locked      : 新しい返信を止める。staff だけが立てられる。
--   reply_count : seq>=2 の生きている投稿の数。スレ削除の可否（返信 0 なら丸ごと消せる）と
--                 一覧表示に使うので、集計せず行に持つ。
--   bumped_at   : 最終書き込み時刻。一覧の既定の並び順。新着順にすると立てたきり動かない
--                 スレが上に残り、掲示板が止まって見える（設計 §2）。
CREATE TABLE IF NOT EXISTS board_threads (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL,          -- suggestion|request|bug|chat|intro|promo
  title           TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT '',
  status_note     TEXT    NOT NULL DEFAULT '',
  shipped_version TEXT    NOT NULL DEFAULT '',
  pinned          INTEGER NOT NULL DEFAULT 0,
  locked          INTEGER NOT NULL DEFAULT 0,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  like_count      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  bumped_at       INTEGER NOT NULL,
  deleted_at      INTEGER NOT NULL DEFAULT 0,
  hidden_at       INTEGER NOT NULL DEFAULT 0
);

-- 一覧（最終書き込み順）と、種別で絞った一覧。ピン留めは件数が少ないので並べ替えで吸収する。
CREATE INDEX IF NOT EXISTS idx_board_threads_bumped ON board_threads (bumped_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_threads_kind ON board_threads (kind, bumped_at DESC);

-- 投稿。**seq=1 がスレ本文**で、2 番以降が返信。
-- 本文を別テーブルにせず投稿の 1 行目に置くことで、削除・通報・非表示の経路が 1 本で済む
--（本文だけ別扱いにすると、同じ処理を 2 通り書くことになり必ず片方が腐る）。
--   reply_to  : 返信先の seq。0 はスレ全体への返信。
--   deleted_at: 投稿者本人の削除。hidden_at: 運営の非表示。どちらも本文は伏せ字で返す
--               （行は残す＝返信のついた会話が虫食いにならない）。
CREATE TABLE IF NOT EXISTS board_posts (
  id         TEXT    PRIMARY KEY,
  thread_id  TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  user_id    TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  reply_to   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0,
  hidden_at  INTEGER NOT NULL DEFAULT 0
);

-- スレを開くときの読み出し（seq 昇順）と、連番の重複防止を兼ねる。
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_posts_seq ON board_posts (thread_id, seq);
-- 「自分の書き込み」タブ。
CREATE INDEX IF NOT EXISTS idx_board_posts_user ON board_posts (user_id, created_at DESC);

-- 👍。種別が request / bug のスレだけに付く（D-BOARD-KIND）。1 アカウント 1 回。
CREATE TABLE IF NOT EXISTS board_likes (
  thread_id  TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- アンケート（D-BOARD-POLL）。1 スレに 1 つまでなので thread_id が主キー。
--   options : JSON 配列（["A","B",...]）。選択肢は 2〜8。
--   closes_at: 締切。必須。締切後は投票できず、未投票でも票数が見える。
CREATE TABLE IF NOT EXISTS board_polls (
  thread_id  TEXT    PRIMARY KEY,
  question   TEXT    NOT NULL,
  options    TEXT    NOT NULL,
  multiple   INTEGER NOT NULL DEFAULT 0,
  closes_at  INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 投票。1 アカウント 1 票で、2 回目は拒否する（上書きしない）。
--   choices: JSON 配列（選んだ選択肢の index）。
CREATE TABLE IF NOT EXISTS board_votes (
  thread_id  TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  choices    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- 通報。件数による自動非表示はしない（結託通報で正常な投稿を落とせるため・D-BOARD-REPORT）。
-- 運営の作業キューとして積むだけで、処理したら handled_at を入れる。
CREATE TABLE IF NOT EXISTS board_reports (
  id         TEXT    PRIMARY KEY,
  post_id    TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,          -- 通報者。公開しない
  reason     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  handled_at INTEGER NOT NULL DEFAULT 0
);

-- 未処理の通報を古い順に見るための索引（運営が 1 日 1 回見るキュー）。
CREATE INDEX IF NOT EXISTS idx_board_reports_open ON board_reports (handled_at, created_at);

-- 外部リンクの OGP キャッシュ（D-BOARD-OGPCACHE）。URL 1 本につき 1 行。
-- **取得は投稿時に 1 回だけ**で、閲覧では外に出ない（閲覧者の数だけ相手サイトを叩かないため）。
--   url_key   : 正規化 URL の SHA-256 先頭 32 桁。
--   kind      : 'ogp'（普通の外部ページ）| 'work'（grove の公開作品）| 'none'（取得できなかった）。
--   image_ok  : og:image のホストが許可表にあったか。0 なら image_url は空でテキストカードに落ちる
--               （任意ドメインの画像を出すと、投稿後の差し替えを止められない・D-BOARD-OGPIMG）。
--   expires_at: これを過ぎたら次に貼られたときに取り直す。失敗は短い TTL で入れて連打を防ぐ。
--   blocked_at: 運営が URL 単位でカードを潰した時刻（投稿は残したまま）。
CREATE TABLE IF NOT EXISTS board_links (
  url_key     TEXT    PRIMARY KEY,
  url         TEXT    NOT NULL,
  host        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  title       TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  image_url   TEXT    NOT NULL DEFAULT '',
  image_ok    INTEGER NOT NULL DEFAULT 0,
  site_name   TEXT    NOT NULL DEFAULT '',
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  blocked_at  INTEGER NOT NULL DEFAULT 0
);

-- 投稿とリンクの結びつき。1 投稿に最大 2 本（BOARD_LIMITS.linksPerPost）。
-- 本文を読み直して URL を抽出せずに済むよう、保存時に確定させて持つ。
CREATE TABLE IF NOT EXISTS board_post_links (
  post_id TEXT    NOT NULL,
  url_key TEXT    NOT NULL,
  ord     INTEGER NOT NULL,          -- 本文での出現順
  PRIMARY KEY (post_id, url_key)
);

CREATE INDEX IF NOT EXISTS idx_board_post_links_post ON board_post_links (post_id, ord);
