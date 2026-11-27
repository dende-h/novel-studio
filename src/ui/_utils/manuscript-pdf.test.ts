import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readManuscriptPdf } from './manuscript-pdf'

const download = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: download.getDocument }))
vi.mock('./manuscript-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./manuscript-file')>()),
  readManuscriptFile: vi.fn(async () => new TextEncoder().encode('%PDF-1.7')),
}))

const file = new File([], 'sample.pdf')
const pages = () =>
  ['一話の本文', '二話の本文', '最後の本文'].map((str) => ({
    cleanup: vi.fn(),
    getTextContent: vi.fn(async () => ({
      items: [{ str, hasEOL: true, fontName: 'font', transform: [10, 0, 0, 10, 25, 100] }],
      styles: {},
    })),
  }))

function loadingTask() {
  const entries = pages()
  const pdf = {
    numPages: entries.length,
    getMetadata: vi.fn(async () => ({ info: { Title: '作品' } })),
    getOutline: vi.fn(async (): Promise<unknown[]> => []),
    getPage: vi.fn(async (number: number) => entries[number - 1]),
    getDestination: vi.fn(async () => [2]),
    getPageIndex: vi.fn(async () => 0),
  }
  const task = {
    promise: Promise.resolve(pdf),
    destroy: vi.fn(async () => {}),
    onPassword: undefined as (() => void) | undefined,
  }
  download.getDocument.mockReturnValue(task)
  return { task, pdf, entries }
}

function bookmark(title: string, dest: unknown, items: unknown[] = []) {
  return { title, dest, items }
}

beforeEach(() => vi.clearAllMocks())

describe('PDFのしおりとリソース解放', () => {
  it('しおりの子をたどり、同じページでは最も深い項目・同階層の先頭を使う', async () => {
    const { task, pdf, entries } = loadingTask()
    pdf.getOutline.mockResolvedValue([
      bookmark('章', [0], [bookmark('第一話', [{ ref: '一' }]), bookmark('同階層の候補', [0])]),
      bookmark('最後の話', 'last'),
      bookmark('第二話', [1]),
    ])
    const source = await readManuscriptPdf(file, new AbortController().signal, '原稿/sample.pdf')
    expect(source.episodes.map(({ title, path, pages }) => [title, path, pages])).toEqual([
      ['第一話', '原稿/sample.pdf', '1–1'],
      ['第二話', '原稿/sample.pdf', '2–2'],
      ['最後の話', '原稿/sample.pdf', '3–3'],
    ])
    expect(source.episodes[0]?.body).toBe('一話の本文')
    expect(source.warnings[0]).toMatch(/保存前にプレビュー.*TXTまたは貼り付け/)
    expect(entries.every((page) => page.cleanup.mock.calls.length === 1)).toBe(true)
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })

  it('文字層に本文がなければTXTか貼り付けを案内する', async () => {
    const { task, entries } = loadingTask()
    for (const page of entries) page.getTextContent.mockResolvedValue({ items: [], styles: {} })
    await expect(readManuscriptPdf(file, new AbortController().signal)).rejects.toThrow(
      /読み取れる文字がありません.*TXT.*貼り付け/,
    )
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })

  it('失敗したページも解放し、PDFタスクを破棄する', async () => {
    const { task, entries } = loadingTask()
    entries[0]?.getTextContent.mockRejectedValueOnce(new Error('文字層の破損'))
    await expect(readManuscriptPdf(file, new AbortController().signal)).rejects.toThrow(
      '文字層の破損',
    )
    expect(entries[0]?.cleanup).toHaveBeenCalledTimes(1)
    expect(entries[1]?.getTextContent).not.toHaveBeenCalled()
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })

  it('文字を抽出している間に中断したら、ページとPDFタスクを即座に解放する', async () => {
    const { task, entries } = loadingTask()
    entries[0]?.getTextContent.mockImplementationOnce(() => new Promise(() => {}))
    const operation = new AbortController()
    const pending = readManuscriptPdf(file, operation.signal)
    const done = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(entries[0]?.getTextContent).toHaveBeenCalled())
    operation.abort()
    await done
    expect(entries[0]?.cleanup).toHaveBeenCalledTimes(1)
    expect(entries[1]?.getTextContent).not.toHaveBeenCalled()
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })

  it('パスワード要求を利用者の中断と区別し、タスクを破棄する', async () => {
    const { task } = loadingTask()
    task.promise = new Promise(() => {})
    const operation = new AbortController()
    const pending = readManuscriptPdf(file, operation.signal)
    const done = expect(pending).rejects.toThrow('パスワード付きのPDF')
    await vi.waitFor(() => expect(typeof task.onPassword).toBe('function'))
    task.onPassword?.()
    await done
    expect(operation.signal.aborted).toBe(false)
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })
})
