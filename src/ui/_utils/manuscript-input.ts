import {
  type LocalManuscriptFile,
  type ManuscriptRead,
  readLooseManuscripts,
  readManuscriptArchive,
} from '@/core/importer/manuscript'
import { MAX_IMPORT_BYTES } from '@/core/importer/text'

export type PickedManuscript = { path: string; file: File }

export const selectManuscripts = (files: File[]) =>
  files.map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }))

export async function droppedManuscripts(transfer: DataTransfer): Promise<PickedManuscript[]> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
  if (!entries.some(Boolean)) return selectManuscripts(Array.from(transfer.files))
  const result: PickedManuscript[] = []
  let bytes = 0
  async function read(entry: FileSystemEntry, prefix = ''): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      bytes += file.size
      if (result.length >= 2000 || bytes > MAX_IMPORT_BYTES)
        throw new Error('原稿は合計20 MB・2,000件まで取り込めます')
      result.push({ path: prefix + file.name, file })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        )
        if (!batch.length) break
        for (const child of batch) await read(child, `${prefix + entry.name}/`)
      }
    }
  }
  for (const entry of entries) if (entry) await read(entry)
  return result
}

async function runWorker(files: LocalManuscriptFile[]): Promise<ManuscriptRead[]> {
  if (typeof Worker === 'undefined') {
    const loose = files.filter((file) => !/\.(?:zip|epub)$/i.test(file.path))
    const archives = await Promise.all(
      files
        .filter((file) => !loose.includes(file))
        .map(async (file) => {
          try {
            return { name: file.path, source: await readManuscriptArchive(file) }
          } catch (error) {
            return {
              name: file.path,
              error: error instanceof Error ? error.message : '原稿を読み込めません',
            }
          }
        }),
    )
    return [...archives, ...(loose.length ? readLooseManuscripts(loose) : [])]
  }
  const worker = new Worker(new URL('./manuscript.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ManuscriptRead[]>) => resolve(event.data)
      worker.onerror = () => reject(new Error('原稿の読み込みが中断されました'))
      worker.onmessageerror = () => reject(new Error('読み込んだ原稿を受け取れません'))
      worker.postMessage(
        { files },
        files.map(({ data }) => data.buffer as ArrayBuffer),
      )
    })
  } finally {
    worker.terminate()
  }
}

export async function readManuscriptPicks(picks: PickedManuscript[]): Promise<ManuscriptRead[]> {
  const output: ManuscriptRead[] = []
  const buffer: LocalManuscriptFile[] = []
  for (const { path, file } of picks) {
    try {
      if (/\.pdf$/i.test(path)) {
        const { readManuscriptPdf } = await import('./manuscript-pdf')
        output.push({ name: path, source: await readManuscriptPdf(file) })
      } else buffer.push({ path, data: new Uint8Array(await file.arrayBuffer()) })
    } catch (error) {
      output.push({
        name: path,
        error: error instanceof Error ? error.message : 'ファイルを読み込めません',
      })
    }
  }
  try {
    return [...output, ...(buffer.length ? await runWorker(buffer) : [])]
  } catch (error) {
    return [
      ...output,
      ...buffer.map(({ path }) => ({
        name: path,
        error: error instanceof Error ? error.message : 'ファイルを読み込めません',
      })),
    ]
  }
}
