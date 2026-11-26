import {
  type LocalManuscriptFile,
  type ManuscriptRead,
  readLooseManuscripts,
  readManuscriptArchive,
} from '@/core/importer/manuscript'

self.onmessage = async (event: MessageEvent<{ files: LocalManuscriptFile[] }>) => {
  const { files } = event.data
  const result: ManuscriptRead[] = []
  const loose: LocalManuscriptFile[] = []
  for (const file of files) {
    if (!/\.(?:zip|epub)$/i.test(file.path)) {
      loose.push(file)
      continue
    }
    try {
      result.push({ name: file.path, source: await readManuscriptArchive(file) })
    } catch (error) {
      result.push({
        name: file.path,
        error: error instanceof Error ? error.message : '原稿を読み込めません',
      })
    }
  }
  if (loose.length) result.push(...readLooseManuscripts(loose))
  self.postMessage(result)
}
