import { afterEach, expect, it, vi } from 'vitest'
import { readManuscriptFile } from './manuscript-file'
import { readManuscriptPicks } from './manuscript-input'

afterEach(() => vi.unstubAllGlobals())

it('値を読み込む前に閉じた場合はファイル読取を中断する', async () => {
  const abort = vi.fn()
  const read = vi.fn()
  class PendingReader {
    onabort?: () => void
    readAsArrayBuffer = read
    abort() {
      abort()
      this.onabort?.()
    }
  }
  vi.stubGlobal('FileReader', PendingReader)
  const operation = new AbortController()
  const pending = readManuscriptFile(new Blob(['原稿']), operation.signal)
  const done = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(read).toHaveBeenCalledTimes(1)
  operation.abort()
  await done
  expect(abort).toHaveBeenCalledTimes(1)
})

it('Workerへ処理を送った後に中断するとWorkerを終了し、エラー行を返さない', async () => {
  const postMessage = vi.fn()
  const terminate = vi.fn()
  class PendingWorker {
    postMessage = postMessage
    terminate = terminate
  }
  vi.stubGlobal('Worker', PendingWorker)
  const operation = new AbortController()
  const pending = readManuscriptPicks(
    [{ path: 'フォルダ/原稿.txt', file: new File(['本文'], '原稿.txt') }],
    operation.signal,
  )
  const done = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
  operation.abort()
  await done
  expect(terminate).toHaveBeenCalledTimes(1)
})
