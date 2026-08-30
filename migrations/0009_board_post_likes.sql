-- 0009_board_post_likes: 👍 をスレッド単位から**投稿単位**へ移す。
--
-- 0008 の `board_likes` は「スレッドに 1 アカウント 1 回」で、画面でもスレッドの見出しに
-- 大きなボタンが 1 つ乗っていた。実際に読み返すと、賛同したいのはスレッドではなく
-- **その中の 1 つの書き込み**（「これに困っている」「この案がいい」）で、見出しのボタンでは
-- どの意見に票が入ったのか誰にも分からない。そこで 👍 を投稿ごとに持ち替える。
--
-- 引き継ぎの決めごと:
--   * 旧 `board_likes` は**消さない**。スレ本文（seq=1）への 👍 として写したうえで、
--     行はそのまま残す（本番に戻す必要が出たときの退避と、集計の突き合わせのため）。
--   * `board_threads.like_count` の意味は「**スレ本文（seq=1）に付いた 👍**」に変わる。
--     一覧の列（要望・不具合の賛同数）はそのまま使える＝旧データの表示先が消えない。

-- 投稿ごとの 👍。1 アカウント 1 回（主キーで重複を止める）。
CREATE TABLE IF NOT EXISTS board_post_likes (
  post_id    TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- 「自分が 👍 した投稿」を引くための索引（将来の一覧用。読み出しは主キー側で足りる）。
CREATE INDEX IF NOT EXISTS idx_board_post_likes_user ON board_post_likes (user_id, created_at DESC);

-- 集計列。差分加算せず、押すたびに数え直して入れる（board-store.ts の toggleLike）。
ALTER TABLE board_posts ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;

-- 旧「スレッドへの 👍」を、そのスレの本文（seq=1）への 👍 として引き継ぐ。
INSERT OR IGNORE INTO board_post_likes (post_id, user_id, created_at)
SELECT p.id, l.user_id, l.created_at
FROM board_likes l
JOIN board_posts p ON p.thread_id = l.thread_id AND p.seq = 1;

-- 引き継いだぶんを集計列へ反映する。
UPDATE board_posts
SET like_count = (SELECT COUNT(*) FROM board_post_likes pl WHERE pl.post_id = board_posts.id);
