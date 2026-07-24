import { blocksToNotation } from '../exporter/blocksToNotation'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { GlossaryEntry, Work } from '../schema'

/**
 * 作品 ⇄ ローカルフォルダ（話ごとテキスト）の往復。
 * 外部サイト入稿に加え、外部 Claude（Claude Code）で本文を編集する橋を兼ねる。
 * 本文はロスレスな正本記法（傍点ネイティブ・@参照は [[名前]] で保存）。
 * block id は本文から位置で再導出するため、安定 id/タイトル・辞書は manifest.json に保持する。
 */

export interface FolderFile {
  path: string
  content: string
}

interface Manifest {
  id: string
  title: string
  episodes: { id: string; title: string; file: string }[]
  glossary?: GlossaryEntry[]
}

const MANIFEST = 'manifest.json'
const pad = (n: number) => String(n).padStart(3, '0')
const episodeFile = (index: number) => `${pad(index + 1)}.txt`

export function workToFolder(work: Work): FolderFile[] {
  const manifest: Manifest = {
    id: work.id,
    title: work.title,
    episodes: work.episodes.map((ep, i) => ({ id: ep.id, title: ep.title, file: episodeFile(i) })),
    // 辞書（@参照の解決先）は manifest に相乗りで往復させる。空/未設定なら省略。
    // 画像（サムネ）は manifest を肥大化させ外部編集に不要なので落とす（正本往復は bundle が担う）。
    ...(work.glossary && work.glossary.length > 0
      ? { glossary: work.glossary.map(({ thumbnail: _thumbnail, ...e }) => e) }
      : {}),
  }
  return [
    { path: MANIFEST, content: JSON.stringify(manifest, null, 2) },
    ...work.episodes.map((ep, i) => ({
      path: episodeFile(i),
      content: blocksToNotation(ep.blocks),
    })),
  ]
}

export function folderToWork(files: FolderFile[]): Work {
  const manifestFile = files.find((f) => f.path === MANIFEST)
  if (!manifestFile) throw new Error('manifest.json が見つかりません')
  const manifest: Manifest = JSON.parse(manifestFile.content)
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  return {
    id: manifest.id,
    title: manifest.title,
    episodes: manifest.episodes.map((e) => {
      const body = byPath.get(e.file)
      if (body === undefined) throw new Error(`本文ファイルが見つかりません: ${e.file}`)
      return { id: e.id, title: e.title, blocks: parseEpisodeBody(body) }
    }),
    ...(manifest.glossary ? { glossary: manifest.glossary } : {}),
  }
}
