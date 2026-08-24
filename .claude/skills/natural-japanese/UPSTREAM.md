# このスキルの出自と更新方法

[coji/natural-japanese](https://github.com/coji/natural-japanese)（MIT）の `skills/natural-japanese/` を
そのままコピーしたもの。仕事の日本語文書（note 記事・ブログ・`docs/` の設計文書・README・レポート・議事録など）向け。

- upstream: <https://github.com/coji/natural-japanese>
- version: v1.4.0（commit `0f1cc1c`, 2026-08-17 時点）
- ライセンス: MIT（`LICENSE` 参照。著作権は coji 氏）

## このリポジトリでの改変

**1か所だけ。** `SKILL.md` の frontmatter `description` の末尾に、発動範囲を切り分ける一文を足した:

> 小説の本文と、novel-studio（コトノハ）のLP・アプリ内文言も対象外（前者は novel-writing、後者は toc-copy スキルを使う）。

工程・references・scripts はいずれも無改変。

## 使うときの注意

- `SKILL.md` 中のコマンド例（`uv run scripts/lint.py` / `uv run skills/natural-japanese/scripts/lint.py`）の
  パスは upstream のリポジトリ構成が前提。このリポジトリでは
  `uv run .claude/skills/natural-japanese/scripts/lint.py <file>` に読み替える
  （スキル起動時にベースディレクトリが渡されるので、通常は自動で解決される）。
- `scripts/calibrate.py` は upstream の `corpus/` を使う開発用ツール。コーパスは持ってきていないので動かない。
  自前コーパスで閾値を再校正したくなったら upstream をクローンして使う。
- 実行には [uv](https://docs.astral.sh/uv/) が必要（依存は PEP 723 で自動解決。`pip install` 不要）。

## 更新する

upstream の新版を取り込むときは、ディレクトリを丸ごと差し替えてから上記の1文を description に足し直すのが早い。

```bash
git clone --depth 1 https://github.com/coji/natural-japanese /tmp/nj
rm -rf .claude/skills/natural-japanese
cp -r /tmp/nj/skills/natural-japanese .claude/skills/natural-japanese
cp /tmp/nj/LICENSE .claude/skills/natural-japanese/LICENSE
# SKILL.md の description 末尾に上記の一文を足し、この UPSTREAM.md の version を更新する
```
