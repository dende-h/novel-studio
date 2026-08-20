-- 0007_visitor_days: 日ごとの実訪問者数（Cookie を使わない自前カウント）。
--
-- Cloudflare Web Analytics が持つのは PV（count）と外部からの着地回数（visits）だけで、
-- 訪問者を識別しない＝「何人来たか」が出せない。毎日見に来る運営者自身が毎日数えられて
-- しまい、他人の人数が読めないため、人数だけをここで持つ。
--
-- visitor は「salt:日付:IP:UA族:サイト」の SHA-256 先頭 16 桁（functions/api/_lib/visitor.ts）。
-- 日付が変わると符号も変わるので、日をまたいだ追跡はできない。IP そのものは保存しない。
-- 1 訪問者×1 日×1 サイトで 1 行。hits はその日のページ読み込み回数（SPA の画面遷移は含まない）。
CREATE TABLE IF NOT EXISTS visitor_days (
  date         TEXT    NOT NULL,            -- JST の YYYY-MM-DD
  site         TEXT    NOT NULL,            -- 'leaf' | 'grove'
  visitor      TEXT    NOT NULL,            -- その日限りの不可逆な符号
  first_seen   INTEGER NOT NULL,            -- 初回ヒットの epoch ms
  hits         INTEGER NOT NULL DEFAULT 1,
  landing_path TEXT    NOT NULL DEFAULT '', -- その日最初に開いたパス
  referer_host TEXT    NOT NULL DEFAULT '', -- その日最初の参照元（'' ＝直接）
  country      TEXT    NOT NULL DEFAULT '',
  device       TEXT    NOT NULL DEFAULT '', -- mobile | tablet | desktop
  PRIMARY KEY (date, site, visitor)
);

-- 日次の集計（SELECT date, site, COUNT(*) ... GROUP BY date, site）用。
CREATE INDEX IF NOT EXISTS idx_visitor_days_date ON visitor_days (date, site);
