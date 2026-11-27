import {
  type LocalManuscriptFile,
  type ManuscriptRead,
  manuscriptReadError,
  readManuscriptFiles,
} from '@/core/importer/manuscript'
import { MAX_IMPORT_BYTES } from '@/core/importer/text'
import { abortable, readManuscriptFile } from './manuscript-file'

export type PickedManuscript = { path: string; file: File }

export const selectManuscripts = (files: File[]) =>
  files.map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }))

export async function droppedManuscripts(
  transfer: DataTransfer,
  signal: AbortSignal,
): Promise<PickedManuscript[]> {
  signal.throwIfAborted()
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
  if (!entries.some(Boolean)) return selectManuscripts(Array.from(transfer.files))
  const result: PickedManuscript[] = []
  let bytes = 0
  async function read(entry: FileSystemEntry, prefix = ''): Promise<void> {
    signal.throwIfAborted()
    if (entry.isFile) {
      const file = await abortable(
        signal,
        () =>
          new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject),
          ),
      )
      bytes += file.size
      if (result.length >= 2000 || bytes > MAX_IMPORT_BYTES)
        throw new Error('原稿は合計20 MB・2,000件まで取り込めます')
      result.push({ path: prefix + file.name, file })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await abortable(
          signal,
          () =>
            new Promise<FileSystemEntry[]>((resolve, reject) =>
              reader.readEntries(resolve, reject),
            ),
        )
        if (!batch.length) break
        for (const child of batch) await read(child, `${prefix + entry.name}/`)
      }
    }
  }
  for (const entry of entries) if (entry) await read(entry)
  return result
}

async function runWorker(
  files: LocalManuscriptFile[],
  signal: AbortSignal,
): Promise<ManuscriptRead[]> {
  signal.throwIfAborted()
  if (typeof Worker === 'undefined') return readManuscriptFiles(files, signal)
  const worker = new Worker(new URL('./manuscript.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await abortable(
      signal,
      () =>
        new Promise((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<ManuscriptRead[]>) => resolve(event.data)
          worker.onerror = () => reject(new Error('原稿の読み込みが中断されました'))
          worker.onmessageerror = () => reject(new Error('読み込んだ原稿を受け取れません'))
          worker.postMessage(
            { files },
            files.map(({ data }) => data.buffer as ArrayBuffer),
          )
        }),
    )
  } finally {
    worker.terminate()
  }
}

export async function readManuscriptPicks(
  picks: PickedManuscript[],
  signal: AbortSignal,
): Promise<ManuscriptRead[]> {
  const output: ManuscriptRead[] = []
  const buffer: LocalManuscriptFile[] = []
  const bufferedInputs: { path: string; bytes: number }[] = []
  for (const { path, file } of picks) {
    signal.throwIfAborted()
    const input = { path, bytes: file.size }
    try {
      if (/\.pdf$/i.test(path)) {
        const { readManuscriptPdf } = await abortable(signal, () => import('./manuscript-pdf'))
        const source = await readManuscriptPdf(file, signal, path)
        output.push({ name: path, inputs: [input], source })
      } else {
        buffer.push({ path, data: await readManuscriptFile(file, signal) })
        bufferedInputs.push(input)
      }
    } catch (error) {
      signal.throwIfAborted()
      output.push(manuscriptReadError(path, [input], error))
    }
  }
  try {
    return [...output, ...(buffer.length ? await runWorker(buffer, signal) : [])]
  } catch (error) {
    signal.throwIfAborted()
    return [
      ...output,
      ...bufferedInputs.map((input) => manuscriptReadError(input.path, [input], error)),
    ]
  }
}
