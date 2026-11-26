import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { readPastedManuscript } from '@/core/importer/manuscript'
import { makePostingWork } from '@/core/importer/posting-work'
import type { ManuscriptEpisode, ManuscriptSource } from '@/core/importer/site-formats'
import { looksLikeText, MAX_IMPORT_BYTES, textBytes } from '@/core/importer/text'
import type { WorkFormat } from '@/core/schema'
import type { SourceNotation } from '@/core/sites/portability'
import type { WorkSummary } from '@/core/storage/workRepository'
import {
  droppedManuscripts,
  type PickedManuscript,
  readManuscriptPicks,
  selectManuscripts,
} from '@/ui/_utils/manuscript-input'
import type { takeNotationHandoff } from '@/ui/_utils/notation-handoff'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { Input } from '@/ui/components/ui/input'
import { Textarea } from '@/ui/components/ui/textarea'
import type { EditorStore } from '@/ui/store/editorStore'
import { joinEpisodes, type ManuscriptSplit, splitManuscripts } from './manuscript-episodes'
import { ImportPreview, NotationSelect, selectClass } from './posting-preview'

type Row = {
  id: number
  name: string
  source?: ManuscriptSource
  error?: string
  bytes: number
  file?: File
  paths?: string[]
}
type EpisodeEdit = { title?: string; body?: string; exclude?: boolean; join?: boolean }

export function ManuscriptImportDialog({
  open,
  onOpenChange,
  store,
  works,
  defaultAuthor,
  defaultFormat,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: EditorStore
  works: WorkSummary[]
  defaultAuthor: string
  defaultFormat: WorkFormat
  initial?: Awaited<ReturnType<typeof takeNotationHandoff>>
  onSaved: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ImportForm
          {...{ store, works, defaultAuthor, defaultFormat, initial, onSaved }}
          close={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function ImportForm({
  store,
  works,
  defaultAuthor,
  defaultFormat,
  initial,
  close,
  onSaved,
}: {
  store: EditorStore
  works: WorkSummary[]
  defaultAuthor: string
  defaultFormat: WorkFormat
  initial?: Awaited<ReturnType<typeof takeNotationHandoff>>
  close: () => void
  onSaved: (id: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const nextId = useRef(1)
  const pickedFiles = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const [paste, setPaste] = useState(initial?.text ?? '')
  const [showPaste, setShowPaste] = useState(Boolean(initial))
  const [mode, setMode] = useState<ManuscriptSplit>('files')
  const [notation, setNotation] = useState<SourceNotation>(initial?.notation ?? 'auto')
  const [supplements, setSupplements] = useState(false)
  const [target, setTarget] = useState('')
  const [format, setFormat] = useState<WorkFormat>(defaultFormat)
  const [titleEdit, setTitleEdit] = useState<string>()
  const [authorEdit, setAuthorEdit] = useState<string>()
  const [order, setOrder] = useState<string[]>([])
  const [edits, setEdits] = useState<Record<string, EpisodeEdit>>({})
  const [previewId, setPreviewId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const readingRef = useRef(false)
  const [error, setError] = useState('')
  const id = useId()

  const pasted = useMemo(() => {
    if (!paste.trim()) return {}
    try {
      return { source: readPastedManuscript(paste) }
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '貼り付けた原稿を読めません' }
    }
  }, [paste])
  const sources = useMemo(() => {
    const listed = rows
      .flatMap((row) => (row.source ? [{ id: row.id, source: row.source }] : []))
      .sort((a, b) => a.source.name.localeCompare(b.source.name, 'ja', { numeric: true }))
    return pasted.source ? [...listed, { id: 0, source: pasted.source }] : listed
  }, [rows, pasted.source])
  const main = sources.find(({ source }) => source.structured) ?? sources[0]
  const root = main?.source.name.split('/')[0]
  const defaultTitle =
    !main?.source.structured && root && main?.source.name.includes('/') ? root : main?.source.title
  const title = titleEdit ?? defaultTitle ?? ''
  const author = authorEdit ?? main?.source.author ?? defaultAuthor
  const sameTitles = works.filter((work) => title.trim() && title.trim() === work.title.trim())
  const items = splitManuscripts(sources, mode, title)
  const all = [
    ...order.flatMap((key) => items.filter((item) => item.id === key)),
    ...items.filter((item) => !order.includes(item.id)),
  ].map((item) => ({
    ...item,
    episode: {
      ...item.episode,
      title: edits[item.id]?.title ?? item.episode.title,
      body: edits[item.id]?.body ?? item.episode.body,
    },
  }))
  const multipleOrigins = new Set(all.map((item) => item.group)).size > 1
  const groups = all.reduce<{ ids: string[]; episode: ManuscriptEpisode }[]>((result, item) => {
    const edit = edits[item.id]
    if (edit?.exclude ?? item.episode.frontMatter) return result
    const last = result.at(-1)
    if (edit?.join && last) {
      last.ids.push(item.id)
      last.episode = joinEpisodes(last.episode, item.episode)
    } else result.push({ ids: [item.id], episode: item.episode })
    return result
  }, [])
  const selected = groups.map((group) => group.episode)
  const active = all.find((item) => item.id === previewId) ?? all[0]
  const combined =
    active && groups.find((group) => group.ids.length > 1 && group.ids.includes(active.id))
  const previewAssets = useAssetUrls(
    active ? sources.find((source) => active.id.startsWith(`${source.id}-`))?.source : undefined,
  )
  const fileForPreview =
    active &&
    rows.find(
      (row) =>
        row.file && row.source?.episodes.some((episode) => episode.path === active.episode.path),
    )?.file
  const totalBytes = rows.reduce((total, row) => total + row.bytes, 0) + textBytes(paste)
  const invalidBody = selected.some(
    (episode) => !episode.body.trim() || !looksLikeText(episode.body),
  )
  const canSave =
    selected.length > 0 &&
    !rows.some((row) => row.error) &&
    !pasted.error &&
    !reading &&
    !busy &&
    !invalidBody &&
    totalBytes <= MAX_IMPORT_BYTES &&
    !!(target || title.trim())

  const patchEpisode = (key: string, edit: EpisodeEdit) =>
    setEdits((current) => ({ ...current, [key]: { ...current[key], ...edit } }))

  async function add(getPicks: () => Promise<PickedManuscript[]>) {
    if (readingRef.current || busy) return
    readingRef.current = true
    setReading(true)
    setError('')
    try {
      const picks = await getPicks()
      const seen = new Set(rows.flatMap((row) => row.paths ?? [row.name]))
      const admitted: PickedManuscript[] = []
      const next: Row[] = []
      const paths = (pick: PickedManuscript) => pick.path.normalize('NFC')
      let bytes = totalBytes
      for (const pick of picks) {
        if (/(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/i.test(pick.path)) continue
        let reason = ''
        if (seen.has(paths(pick))) reason = '同じ相対パスのファイルがあります'
        else if (bytes + pick.file.size > MAX_IMPORT_BYTES || seen.size >= 2000)
          reason = '原稿は合計20 MB・2,000件まで取り込めます'
        if (reason) next.push({ id: nextId.current++, name: pick.path, error: reason, bytes: 0 })
        else {
          bytes += pick.file.size
          seen.add(paths(pick))
          admitted.push(pick)
        }
        if (next.length >= 2000) break
      }
      const results = await readManuscriptPicks(admitted)
      for (const result of results) {
        const matches = admitted.filter(
          (pick) => pick.path === result.name || pick.path.startsWith(`${result.name}/`),
        )
        const rawBytes = matches.reduce((sum, pick) => sum + pick.file.size, 0)
        const size = 'source' in result ? Math.max(rawBytes, result.source.expandedBytes ?? 0) : 0
        const exact = matches.find((pick) => pick.path === result.name)
        next.push({
          ...result,
          id: nextId.current++,
          bytes: size,
          paths: matches.map(paths),
          file: exact && /\.pdf$/i.test(exact.path) ? exact.file : undefined,
        })
      }
      setRows((current) => [...current, ...next])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '原稿を読み込めません')
    } finally {
      readingRef.current = false
      setReading(false)
    }
  }

  function move(index: number, delta: number) {
    const keys = all.map((item) => item.id)
    const other = index + delta
    if (other < 0 || other >= keys.length) return
    ;[keys[index], keys[other]] = [keys[other]!, keys[index]!]
    setOrder(keys)
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError('')
    try {
      const work = makePostingWork(
        {
          title: target ? (works.find((item) => item.id === target)?.title ?? title) : title,
          author,
          description: main?.source.description,
          format,
          episodes: selected,
          sources: sources.map((item) => item.source),
          notation,
          supplements,
        },
        () => crypto.randomUUID(),
        Date.now,
      )
      if (target) await store.appendImportedEpisodes(target, work)
      else await store.importWorks([work])
      close()
      onSaved(target || work.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '原稿を保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent
      className="max-h-[90dvh] overflow-auto sm:max-w-5xl"
      onInteractOutside={(event) => {
        if (busy) event.preventDefault()
      }}
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault()
      }}
    >
      <DialogHeader>
        <DialogTitle>原稿を取り込む</DialogTitle>
        <DialogDescription>
          ファイルや貼り付けた原稿から、新しい作品を作るか、既存作品の末尾に話を追加できます。
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="min-w-0 space-y-3" aria-label="原稿と保存先">
          <fieldset
            aria-label="原稿を選ぶ"
            className="space-y-2 rounded-lg border border-dashed border-outline-variant p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const transfer = event.dataTransfer
              void add(() => droppedManuscripts(transfer))
            }}
          >
            <p className="text-sm text-on-surface-variant">
              TXT、原稿ZIP、PDF、EPUBをここにドロップできます。
            </p>
            <input
              type="file"
              aria-label="原稿ファイル"
              ref={pickedFiles}
              accept=".txt,.zip,.pdf,.epub"
              multiple
              hidden
              onChange={(event) => {
                const picks = selectManuscripts(Array.from(event.currentTarget.files ?? []))
                event.currentTarget.value = ''
                void add(async () => picks)
              }}
            />
            <input
              type="file"
              aria-label="原稿フォルダ"
              ref={folder}
              {...{ webkitdirectory: '' }}
              multiple
              hidden
              onChange={(event) => {
                const picks = selectManuscripts(Array.from(event.currentTarget.files ?? []))
                event.currentTarget.value = ''
                void add(async () => picks)
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={reading || busy}
                onClick={() => pickedFiles.current?.click()}
              >
                ファイルを選ぶ
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={reading || busy}
                onClick={() => folder.current?.click()}
              >
                フォルダを選ぶ
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showPaste}
                onClick={() => setShowPaste(!showPaste)}
              >
                貼り付け
              </Button>
            </div>
          </fieldset>
          {showPaste && (
            <div>
              <label htmlFor={`${id}-paste`} className="text-sm">
                貼り付ける原稿
              </label>
              <Textarea
                id={`${id}-paste`}
                rows={4}
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
              />
            </div>
          )}
          {pasted.error && (
            <p role="alert" className="text-sm text-destructive">
              {pasted.error}
            </p>
          )}
          {reading && (
            <p role="status" className="text-sm">
              原稿を読み込み中…
            </p>
          )}
          {rows.length > 0 && (
            <ul className="max-h-44 space-y-2 overflow-auto text-sm">
              {rows.map((row) => (
                <li key={row.id} className="rounded-md border border-outline-variant/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all">{row.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${row.name}を外す`}
                      disabled={busy || reading}
                      onClick={() =>
                        setRows((current) => current.filter((item) => item.id !== row.id))
                      }
                    >
                      外す
                    </Button>
                  </div>
                  {row.error && (
                    <p role="alert" className="text-destructive">
                      {row.error}
                    </p>
                  )}
                  {row.source?.warnings.length ? (
                    <details open>
                      <summary>取込時の確認</summary>
                      <ul className="space-y-1">
                        {[...new Set(row.source.warnings)].map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <label className="flex flex-wrap items-center gap-2 text-sm">
            保存先
            <select
              className={selectClass}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">新しい作品を作る</option>
              {works.map((work) => (
                <option key={work.id} value={work.id}>
                  {work.title}（{work.episodeCount}話）に追加
                </option>
              ))}
            </select>
          </label>
          {!target && (
            <div className="grid gap-2">
              <fieldset className="flex gap-3 text-sm">
                <legend>作品の形式</legend>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={id + '-format'}
                    checked={format === 'novel'}
                    onChange={() => setFormat('novel')}
                  />
                  小説
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={id + '-format'}
                    checked={format === 'script'}
                    onChange={() => setFormat('script')}
                  />
                  脚本
                </label>
              </fieldset>
              <label htmlFor={`${id}-title`} className="text-sm">
                作品名
                <Input
                  id={`${id}-title`}
                  value={title}
                  onChange={(event) => setTitleEdit(event.target.value)}
                />
              </label>
              {sameTitles.length > 0 && (
                <p className="text-sm text-on-surface-variant">
                  同じ作品名があります。
                  {sameTitles.map((work) => `${work.title}（${work.episodeCount}話）`).join('、')}
                </p>
              )}
              <label htmlFor={`${id}-author`} className="text-sm">
                著者名
                <Input
                  id={`${id}-author`}
                  value={author}
                  onChange={(event) => setAuthorEdit(event.target.value)}
                />
              </label>
              {main?.source.description && (
                <details className="text-sm">
                  <summary>あらすじ</summary>
                  <p className="whitespace-pre-wrap">{main.source.description}</p>
                </details>
              )}
            </div>
          )}
          <label className="flex flex-wrap items-center gap-2 text-sm">
            話の分け方
            <select
              className={selectClass}
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as ManuscriptSplit)
                setOrder([])
                setEdits({})
                setPreviewId(undefined)
              }}
            >
              <option value="files">原稿の話順／1ファイル＝1話</option>
              <option value="heading">見出し行で分ける</option>
              <option value="whole">1話にまとめる</option>
            </select>
          </label>
          <NotationSelect value={notation} onChange={setNotation} />
          <details className="text-sm">
            <summary>原稿の取り込み方</summary>
            <p className="mt-1">
              カクヨム・なろう・アカツキの原稿ZIPや解凍済みTXTを選べます。ほかのサイトの本文は、TXTを選ぶか、編集画面からコピーして貼り付けてください。
            </p>
            <p className="mt-1">
              PDFは文字層、EPUBは目次と本文を読み取ります。本文の順序や話の境界はプレビューで確認してください。
            </p>
          </details>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={supplements}
              onChange={(event) => setSupplements(event.target.checked)}
            />
            前書きと後書きを本文に含める
          </label>
        </section>
        <section className="min-w-0 space-y-3" aria-label="取り込む話の確認">
          <h3 className="font-medium">取り込む話（{selected.length}話）</h3>
          {!all.length && (
            <p className="text-sm text-on-surface-variant">
              原稿を選ぶと、話タイトルと本文を確認できます。
            </p>
          )}
          <ol className="max-h-56 space-y-2 overflow-auto">
            {all.map((item, index) => (
              <li key={item.id} className="rounded-md border border-outline-variant/50 p-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`${index + 1}話目を取り込む`}
                    checked={!(edits[item.id]?.exclude ?? item.episode.frontMatter)}
                    onChange={(event) => patchEpisode(item.id, { exclude: !event.target.checked })}
                  />
                  <Input
                    aria-label={`${index + 1}話目のタイトル`}
                    value={item.episode.title}
                    placeholder={`第${index + 1}話`}
                    onChange={(event) => patchEpisode(item.id, { title: event.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewId(item.id)}
                    aria-pressed={active?.id === item.id}
                  >
                    本文
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {multipleOrigins && (
                    <span className="break-all pr-1 text-xs text-on-surface-variant">
                      {item.group}
                    </span>
                  )}
                  <Button
                    aria-label={`${index + 1}話目を上へ`}
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    aria-label={`${index + 1}話目を下へ`}
                    variant="ghost"
                    size="sm"
                    disabled={index === all.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  {index > 0 && (
                    <label className="flex gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(edits[item.id]?.join)}
                        onChange={(event) => patchEpisode(item.id, { join: event.target.checked })}
                      />
                      前の話につなぐ
                    </label>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {combined && (
            <details open className="text-sm">
              <summary>つないだ本文（{combined.episode.title || 'タイトル未入力'}）</summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                {combined.episode.body}
              </pre>
            </details>
          )}
          {active && (
            <ImportPreview
              episode={active.episode}
              notation={notation}
              supplements={supplements}
              onEdit={(body) => patchEpisode(active.id, { body })}
              assets={previewAssets}
              openPdf={
                fileForPreview &&
                (() => {
                  const url = URL.createObjectURL(fileForPreview)
                  window.open(url, '_blank', 'noopener,noreferrer')
                  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
                })
              }
            />
          )}
        </section>
      </div>
      <DialogFooter className="items-center gap-2">
        {(error || totalBytes > MAX_IMPORT_BYTES || invalidBody) && (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {error ||
              (invalidBody
                ? '取り込む話の本文を入力し、読み込めない文字を除いてください。'
                : '原稿は展開後も合計20 MBまで取り込めます。')}
          </p>
        )}
        <Button variant="outline" disabled={busy} onClick={close}>
          閉じる
        </Button>
        <Button disabled={!canSave} onClick={() => void save()}>
          {busy ? '保存中…' : target ? '話を追加' : '作品を作る'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function useAssetUrls(source?: ManuscriptSource) {
  const [assets, setAssets] = useState<{ path: string; url: string }[]>([])
  useEffect(() => {
    const next = (source?.assets ?? []).map(({ path, data }) => ({
      path,
      url: URL.createObjectURL(new Blob([new Uint8Array(data)])),
    }))
    setAssets(next)
    return () => {
      for (const asset of next) URL.revokeObjectURL(asset.url)
    }
  }, [source])
  return assets
}
