import { blocksToKakuyomu } from '../../core/exporter/toKakuyomu'
import { blocksToNarou } from '../../core/exporter/toNarou'
import { buildEpubFiles } from '../../core/exporter/toEpub'
import { exportBundle } from '../../core/bundle'
import { workToFolder } from '../../core/folder'
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

export function workEpubExport(work: Work): ExportFile {
  const bytes = zipStore(buildEpubFiles(work).map((f) => ({ path: f.path, data: f.content })))
  return { filename: `${safeName(work.title)}.epub`, mime: 'application/epub+zip', data: bytes }
}

export function worksBundleExport(works: Work[]): ExportFile {
  return {
    filename: 'novel-studio-bundle.json',
    mime: 'application/json;charset=utf-8',
    data: exportBundle(works),
  }
}

export function workFolderZipExport(work: Work): ExportFile {
  const bytes = zipStore(workToFolder(work).map((f) => ({ path: f.path, data: f.content })))
  return { filename: `${safeName(work.title)}_folder.zip`, mime: 'application/zip', data: bytes }
}
