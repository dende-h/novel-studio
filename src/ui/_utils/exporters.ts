import { exportBundle } from '../../core/bundle'
import { buildEpubFiles } from '../../core/exporter/toEpub'
import { blocksToKakuyomu } from '../../core/exporter/toKakuyomu'
import { blocksToNarou } from '../../core/exporter/toNarou'
import { buildNovelGameFiles, type NovelGameOptions } from '../../core/exporter/toNovelGame'
import { glossaryToPlainText, workToPlainText } from '../../core/exporter/toPlainText'
import { workToFolder } from '../../core/folder'
import type { Staging } from '../../core/game'
import type { Episode, Work } from '../../core/schema'
import { zipStore } from '../../core/zip'

/**
 * 書き出しビルダー（純粋・DOM 非依存）。
 * core の各 exporter を合成し、ダウンロード用の {filename, mime, data} を作る。
 * 実際のダウンロード発火は _utils/download の triggerDownload が担う。
 */

export interface ExportFile {
  filename: string
  mime: string
  data: string | Uint8Array
}

/** ファイル名に使えない文字を全角・アンダースコアへ。 */
function safeName(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').trim() || 'untitled'
}

export function episodeNarouExport(workTitle: string, ep: Episode): ExportFile {
  return {
    filename: `${safeName(workTitle)}_${safeName(ep.title)}_narou.txt`,
    mime: 'text/plain;charset=utf-8',
    data: blocksToNarou(ep.blocks),
  }
}

export function episodeKakuyomuExport(workTitle: string, ep: Episode): ExportFile {
  return {
    filename: `${safeName(workTitle)}_${safeName(ep.title)}_kakuyomu.txt`,
    mime: 'text/plain;charset=utf-8',
    data: blocksToKakuyomu(ep.blocks),
  }
}

/**
 * 1話 → ブラウザで遊べるサウンドノベル zip（index.html ＋ assets/）。
 * staging（演出譜）を渡すと話者・背景・場面の切れ目が載る。無ければ演出ゼロの完全自動。
 */
export function episodeNovelGameExport(
  work: Work,
  ep: Episode,
  opts: NovelGameOptions,
  staging?: Staging,
): ExportFile {
  const bytes = zipStore(buildNovelGameFiles(work, ep, staging, opts))
  return {
    filename: `${safeName(work.title)}_${safeName(ep.title)}_novelgame.zip`,
    mime: 'application/zip',
    data: bytes,
  }
}

export function workEpubExport(work: Work): ExportFile {
  const bytes = zipStore(buildEpubFiles(work).map((f) => ({ path: f.path, data: f.content })))
  return { filename: `${safeName(work.title)}.epub`, mime: 'application/epub+zip', data: bytes }
}

export function worksBundleExport(works: Work[]): ExportFile {
  return {
    filename: 'kotonoha-leaf-bundle.json',
    mime: 'application/json;charset=utf-8',
    data: exportBundle(works),
  }
}

export function workFolderZipExport(work: Work): ExportFile {
  const bytes = zipStore(workToFolder(work).map((f) => ({ path: f.path, data: f.content })))
  return { filename: `${safeName(work.title)}_folder.zip`, mime: 'application/zip', data: bytes }
}

/**
 * AI に読ませる用のプレーンテキスト .txt。コピペが長さ制限で切れる長編向けに、
 * ChatGPT / Gemini などへ「ファイル添付」でまるごと渡せるようにする（コピー導線と同じ本文）。
 */
export function workAiTextExport(work: Work, includeGlossary: boolean): ExportFile {
  const glossary = work.glossary ?? []
  const body =
    includeGlossary && glossary.length > 0
      ? `${workToPlainText(work)}\n\n${glossaryToPlainText(glossary)}`
      : workToPlainText(work)
  return {
    filename: `${safeName(work.title)}_AI.txt`,
    mime: 'text/plain;charset=utf-8',
    data: body,
  }
}
