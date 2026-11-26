import { useId, useRef, useState } from 'react'
import { blocksToNotation } from '@/core/exporter/blocksToNotation'
import { readPastedManuscript, readSingleManuscript } from '@/core/importer/manuscript'
import { manuscriptBlocks } from '@/core/importer/posting-work'
import type { ManuscriptSource } from '@/core/importer/site-formats'
import { MAX_IMPORT_BYTES } from '@/core/importer/text'
import type { SourceNotation } from '@/core/sites/portability'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { Textarea } from '@/ui/components/ui/textarea'
import { seemsMultiEpisode } from './manuscript-episodes'
import { ImportPreview, NotationSelect, selectClass } from './posting-preview'

export type CurrentDraft = { workId: string; episodeId: string; draft: string; title: string }
const home = '複数話はホームの「原稿を取り込む」から追加できます。'

export function EpisodeImportDialog({
  opened,
  current,
  onClose,
  onCommit,
}: {
  opened: CurrentDraft
  current: CurrentDraft | null
  onClose: () => void
  onCommit: (draft: CurrentDraft, body: string) => Promise<void>
}) {
  const id = useId()
  const [base, setBase] = useState(opened)
  const [paste, setPaste] = useState('')
  const [file, setFile] = useState<ManuscriptSource>()
  const [notation, setNotation] = useState<SourceNotation>('auto')
  const [supplements, setSupplements] = useState(false)
  const [method, setMethod] = useState<'append' | 'replace'>('append')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputVersion = useRef(0)
  let source = file
  let validation = ''
  if (paste.trim()) {
    try {
      source = readPastedManuscript(paste)
    } catch (cause) {
      validation = cause instanceof Error ? cause.message : '原稿を読めません'
    }
  }
  const episode = source?.episodes[0]
  const multi = Boolean(episode && (source!.episodes.length > 1 || seemsMultiEpisode(episode)))
  const imported =
    episode && !multi && episode.body.trim()
      ? blocksToNotation(manuscriptBlocks(episode, notation, supplements))
      : ''
  const next =
    base.draft && method === 'append'
      ? base.draft + (base.draft.endsWith('\n') ? '' : '\n') + imported
      : imported
  const stale =
    !current ||
    current.workId !== base.workId ||
    current.episodeId !== base.episodeId ||
    current.draft !== base.draft
  const sameEpisode = current?.workId === base.workId && current?.episodeId === base.episodeId

  async function select(files: File[]) {
    const version = ++inputVersion.current
    setConfirming(false)
    setPaste('')
    setFile(undefined)
    setError('')
    if (files.length !== 1) {
      setReading(false)
      setError(`TXTを1件選んでください。${home}`)
      return
    }
    const selected = files[0]!
    setReading(true)
    try {
      if (selected.size > MAX_IMPORT_BYTES) throw new Error('原稿は20 MBまで取り込めます')
      const data = new Uint8Array(await selected.arrayBuffer())
      if (version === inputVersion.current) setFile(readSingleManuscript(selected.name, data))
    } catch (cause) {
      if (version === inputVersion.current)
        setError(
          `${selected.name} — ${cause instanceof Error ? cause.message : '原稿を読めません'}`,
        )
    } finally {
      if (version === inputVersion.current) setReading(false)
    }
  }

  async function confirm() {
    if (stale || !imported || saving || reading) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onCommit(base, next)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本文を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>本文を取り込む</DialogTitle>
          <DialogDescription>
            「{base.title}」の本文に、TXT1件か貼り付けた原稿を取り込みます。
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <label htmlFor={`${id}-confirmation`} className="text-sm">
            変更後の本文（記法付き）
            <Textarea id={`${id}-confirmation`} value={next} rows={12} readOnly />
          </label>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              TXTファイルを選ぶ
              <input
                className="ml-2 max-w-full"
                type="file"
                accept=".txt"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ''
                  if (files.length) void select(files)
                }}
              />
            </label>
            <label htmlFor={`${id}-paste`} className="block text-sm">
              原稿を貼り付ける
              <Textarea
                id={`${id}-paste`}
                rows={5}
                value={paste}
                onChange={(event) => {
                  inputVersion.current += 1
                  setReading(false)
                  setFile(undefined)
                  setError('')
                  setPaste(event.target.value)
                }}
              />
            </label>
            {reading && <p role="status">原稿を読み込み中…</p>}
            <NotationSelect value={notation} onChange={setNotation} />
            {episode && !multi && (
              <>
                <p className="text-sm">元の話タイトル　{episode.title || 'なし'}</p>
                <ImportPreview episode={episode} notation={notation} supplements={supplements} />
              </>
            )}
            {episode && (episode.before || episode.after) && (
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={supplements}
                  onChange={(event) => setSupplements(event.target.checked)}
                />
                前書きと後書きを本文に含める
              </label>
            )}
            {base.draft && (
              <label className="flex items-center gap-2 text-sm">
                取り込み方
                <select
                  className={selectClass}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as typeof method)}
                >
                  <option value="append">末尾に追加</option>
                  <option value="replace">本文を置き換える</option>
                </select>
              </label>
            )}
          </div>
        )}
        {multi && (
          <p role="alert" className="text-destructive text-sm">
            複数話が含まれています。{home}
          </p>
        )}
        {(error || validation) && (
          <p role="alert" className="text-destructive text-sm">
            {error || validation}
          </p>
        )}
        {stale && (
          <div className="space-y-2">
            <p role="alert" className="text-destructive text-sm">
              開いている話か本文が変わりました。
            </p>
            {sameEpisode && current && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBase(current)
                  setConfirming(false)
                  setError('')
                }}
              >
                最新の本文で確認する
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={confirming ? () => setConfirming(false) : onClose}
          >
            {confirming ? '戻る' : '閉じる'}
          </Button>
          <Button
            disabled={stale || !imported || Boolean(validation) || saving || reading}
            onClick={() => void confirm()}
          >
            {saving
              ? '保存中…'
              : !confirming
                ? '変更後の本文を確認'
                : !base.draft
                  ? '本文に入れる'
                  : method === 'append'
                    ? '末尾に追加'
                    : '本文を置き換える'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
