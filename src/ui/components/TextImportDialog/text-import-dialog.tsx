import { CheckCircle2, PenLine } from 'lucide-react'
import { useId, useState } from 'react'
import { buildImportedWork, MAX_WORK_JSON_BYTES, workJsonBytes } from '@/core/importer'
import type { Work } from '@/core/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { useIsNarrow } from '@/ui/hooks/use-narrow'
import { PreviewPane } from './preview-pane'
import { SourcePane } from './source-pane'
import { MESSAGES, useTextImport } from './use-text-import'

interface TextImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 著者の既定値（プロフィールのペンネーム）。 */
  defaultAuthor?: string
  /** 組み立てた Work を保存する（`store.importWorks([work])`）。 */
  onCreate: (work: Work) => Promise<void>
  /** 「執筆を始める」：作った作品を開いて執筆画面へ。 */
  onWrite: (workId: string) => void | Promise<void>
  /** テストで差し替えるための id・時刻の供給元。 */
  genId?: () => string
  now?: () => number
}

type Phase = { kind: 'edit' } | { kind: 'done'; workId: string; title: string; count: number }

const defaultGenId = () => crypto.randomUUID()

/**
 * テキストから作品を作るダイアログ。.txt（複数）か貼り付けた本文を見出し行で話に分け、
 * プレビューで確かめてから新しい作品として保存する。desktop は左右 2 ペイン、lg 未満は 2 ステップ。
 */
export function TextImportDialog({
  open,
  onOpenChange,
  defaultAuthor = '',
  onCreate,
  onWrite,
  genId = defaultGenId,
  now = Date.now,
}: TextImportDialogProps) {
  const narrow = useIsNarrow()
  const { state, preview, workTitle, loading, actions } = useTextImport(defaultAuthor)
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  const [step, setStep] = useState<1 | 2>(1)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const titleId = `${uid}-title`
  const authorId = `${uid}-author`

  const reset = () => {
    actions.reset()
    setPhase({ kind: 'edit' })
    setStep(1)
    setBusy(false)
  }

  const handleOpenChange = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }

  const hasInput = preview.sources.length > 0
  const canCreate =
    phase.kind === 'edit' &&
    preview.episodes.length > 0 &&
    workTitle.trim() !== '' &&
    !busy &&
    !loading

  const handleCreate = async () => {
    if (!canCreate) return
    setBusy(true)
    try {
      const work = buildImportedWork(
        {
          title: workTitle.trim(),
          author: state.author,
          episodes: preview.episodes.map((e) => ({ title: e.title, body: e.body })),
        },
        genId,
        now,
      )
      if (workJsonBytes(work) > MAX_WORK_JSON_BYTES) {
        actions.setError(MESSAGES.workTooLarge)
        return
      }
      await onCreate(work)
      setPhase({ kind: 'done', workId: work.id, title: work.title, count: work.episodes.length })
    } finally {
      setBusy(false)
    }
  }

  const workInfo = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={titleId}>作品タイトル</Label>
        <Input
          id={titleId}
          value={workTitle}
          onChange={(e) => actions.setWorkTitle(e.target.value)}
          placeholder={MESSAGES.defaultWorkTitle}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={authorId}>著者</Label>
        <Input
          id={authorId}
          value={state.author}
          onChange={(e) => actions.setAuthor(e.target.value)}
          placeholder="ペンネーム（未設定）"
        />
      </div>
    </div>
  )

  const sourcePane = (
    <SourcePane
      kind={state.kind}
      files={state.files}
      paste={state.paste}
      options={state.options}
      actions={actions}
    />
  )

  const previewPane = (
    <PreviewPane
      episodes={preview.episodes}
      headingFound={preview.headingFound}
      totalChars={preview.totalChars}
      headingMode={state.options.mode === 'heading'}
      showSource={state.kind === 'file'}
      actions={actions}
    />
  )

  const errorSlot = (
    <span className="min-w-0 flex-1 text-destructive text-sm" role="alert">
      {state.error}
    </span>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('gap-0 overflow-hidden p-0', !narrow && 'md:max-w-3xl lg:max-w-5xl')}
      >
        <DialogHeader
          className={cn(
            'border-outline-variant/30 border-b px-6 py-4',
            narrow ? 'text-center' : 'text-left',
          )}
        >
          <DialogTitle className="font-serif text-primary text-xl">
            テキストから作品を作る
          </DialogTitle>
          <DialogDescription>.txt や貼り付けた本文を、見出しの行で話に分けます。</DialogDescription>
          {narrow && phase.kind === 'edit' ? (
            <p className="flex items-center justify-center gap-1.5 text-on-surface-variant text-xs">
              <span className={cn(step === 1 && 'font-semibold text-primary')}>1 読み込む</span>
              <span aria-hidden>›</span>
              <span className={cn(step === 2 && 'font-semibold text-primary')}>2 確かめる</span>
            </p>
          ) : null}
        </DialogHeader>

        {phase.kind === 'edit' ? (
          narrow ? (
            <DialogBody className="mx-0 px-5 py-4">
              {step === 1 ? (
                sourcePane
              ) : (
                <div className="flex flex-col gap-5">
                  {workInfo}
                  {previewPane}
                </div>
              )}
            </DialogBody>
          ) : (
            <div className="flex min-h-[360px] flex-1 overflow-hidden">
              <div className="flex w-[46%] shrink-0 flex-col gap-5 overflow-y-auto border-outline-variant/30 border-r bg-surface-container-low p-5">
                {sourcePane}
                {workInfo}
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto p-5">{previewPane}</div>
            </div>
          )
        ) : (
          <DialogBody className="mx-0 px-6 py-8">
            <p className="flex items-center justify-center gap-2 text-center font-serif text-lg text-on-surface">
              <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
              {phase.count} 話で「{phase.title}」を作りました
            </p>
            <p className="text-center text-on-surface-variant text-sm">
              作品一覧に追加されています。
            </p>
          </DialogBody>
        )}

        <DialogFooter className="mx-0 mb-0 items-center border-outline-variant/30 border-t px-6 py-4 sm:justify-between">
          {phase.kind === 'edit' ? (
            <>
              {errorSlot}
              <div className={cn('flex gap-2', narrow && 'flex-col-reverse')}>
                {narrow && step === 2 ? (
                  <Button
                    variant="outline"
                    className="text-primary"
                    onClick={() => setStep(1)}
                    disabled={busy}
                  >
                    戻る
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="text-primary"
                    onClick={() => handleOpenChange(false)}
                    disabled={busy}
                  >
                    キャンセル
                  </Button>
                )}
                {narrow && step === 1 ? (
                  <Button onClick={() => setStep(2)} disabled={!hasInput || loading}>
                    次へ
                  </Button>
                ) : (
                  <Button onClick={() => void handleCreate()} disabled={!canCreate}>
                    {busy ? '作成中…' : '作品を作る'}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="flex-1" />
              <div className={cn('flex gap-2', narrow && 'flex-col-reverse')}>
                <Button
                  variant="outline"
                  className="text-primary"
                  onClick={() => handleOpenChange(false)}
                >
                  閉じる
                </Button>
                <Button
                  className="gap-2"
                  onClick={() => {
                    const id = phase.workId
                    handleOpenChange(false)
                    void onWrite(id)
                  }}
                >
                  <PenLine className="size-4" aria-hidden />
                  執筆を始める
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
