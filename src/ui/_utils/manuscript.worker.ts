import { type LocalManuscriptFile, readManuscriptFiles } from '@/core/importer/manuscript'

self.onmessage = async (event: MessageEvent<{ files: LocalManuscriptFile[] }>) => {
  self.postMessage(await readManuscriptFiles(event.data.files))
}
