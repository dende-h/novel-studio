import { FileText, Upload, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { SplitMode, SplitOptions } from '@/core/importer'
import { cn } from '@/lib/utils'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import type { FileEntry, SourceKind, TextImportActions } from './use-text-import'

interface SourcePaneProps {
  kind: SourceKind
  files: FileEntry[]
  paste: string
  options: SplitOptions
  actions: Pick<
    TextImportActions,
    'setKind' | 'addFiles' | 'removeFile' | 'setPaste' | 'setOptions'
  >
}

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'heading', label: '見出し行で分ける' },
  { value: 'file', label: 'ファイルごとに1話' },
  { value: 'none', label: '分けない' },
]

const fmt = (n: number) => n.toLocaleString('ja-JP')
const encodingLabel = (e: 'utf-8' | 'shift_jis') => (e === 'utf-8' ? 'UTF-8' : 'Shift_JIS')

/** 左ペイン：入力元（ファイル／貼り付け）と分け方。 */
export function SourcePane({ kind, files, paste, options, actions }: SourcePaneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const uid = useId()
  const pasteId = `${uid}-paste`
  const sepId = `${uid}-sep`
  const keepId = `${uid}-keep`
  const radioName = `${uid}-mode`

  return (
    <div className="flex flex-col gap-5">
      <fieldset
        aria-label="入力元"
        className="inline-flex w-fit overflow-hidden rounded-md border border-input"
      >
        {(['file', 'paste'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => actions.setKind(k)}
            className={cn(
              'px-4 py-1.5 text-sm transition-colors',
              kind === k
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container-low',
            )}
          >
            {k === 'file' ? 'ファイル' : '貼り付け'}
          </button>
        ))}
      </fieldset>

      {kind === 'file' ? (
        <div className="flex flex-col gap-3">
          {/* 隠しファイル入力（ボタンから開く）。同じファイルを選び直せるよう値を毎回リセット。 */}
          <input
            ref={inputRef}
            type="file"
            accept=".txt"
            multiple
            className="sr-only"
            aria-label="テキストファイル"
            onChange={(e) => {
              const picked = e.target.files ? [...e.target.files] : []
              e.target.value = ''
              if (picked.length > 0) actions.addFiles(picked)
            }}
          />
          <section
            aria-label="ファイルの投入"
            className={cn(
              'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-5 text-center transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-outline-variant/40',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              actions.addFiles([...e.dataTransfer.files])
            }}
          >
            <div>
              <p className="font-medium text-on-surface text-sm">ここにファイルをドロップ</p>
              <p className="text-on-surface-variant text-xs">
                .txt（UTF-8 / Shift_JIS）・複数可・合計 20MB まで
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2 text-primary"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-4" />
              ファイルを選択
            </Button>
          </section>

          {files.length > 0 ? (
            <ul className="flex flex-col gap-1.5" aria-label="読み込んだファイル">
              {files.map((f) => (
                <li
                  key={f.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm"
                >
                  <FileText className="size-4 shrink-0 text-on-surface-variant" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-on-surface">{f.name}</span>
                  {f.state === 'loading' ? (
                    <span className="text-on-surface-variant text-xs">読み込み中…</span>
                  ) : null}
                  {f.state === 'ok' ? (
                    <>
                      <span className="text-on-surface-variant text-xs tabular-nums">
                        {fmt(f.chars)}字
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          f.encoding === 'utf-8' && 'bg-surface-container text-on-surface-variant',
                        )}
                      >
                        {encodingLabel(f.encoding)}
                      </Badge>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-on-surface-variant text-xs"
                    onClick={() => actions.removeFile(f.name)}
                    aria-label={`「${f.name}」を外す`}
                  >
                    <X className="size-3.5" aria-hidden />
                    外す
                  </Button>
                  {f.state === 'error' ? (
                    <p className="basis-full text-destructive text-xs">{f.message}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={pasteId}>本文</Label>
          <Textarea
            id={pasteId}
            value={paste}
            onChange={(e) => actions.setPaste(e.target.value)}
            rows={12}
            placeholder={'第1話　はじまり\n\n　ここに本文を貼り付けます。'}
            className="min-h-[200px] font-sans text-sm leading-7"
          />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-on-surface text-sm">分け方</legend>
        {MODES.map((m) => {
          const disabled = m.value === 'file' && kind === 'paste'
          return (
            <label
              key={m.value}
              className={cn(
                'flex items-center gap-2.5 text-sm',
                disabled ? 'text-on-surface-variant/60' : 'text-on-surface',
              )}
            >
              <input
                type="radio"
                name={radioName}
                value={m.value}
                checked={options.mode === m.value}
                disabled={disabled}
                onChange={() => actions.setOptions({ mode: m.value })}
              />
              {m.label}
            </label>
          )
        })}
        <p className="text-on-surface-variant text-xs">
          見出し行＝「第1話」「プロローグ」「1.」「#」などで始まる短い行
        </p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <Label htmlFor={sepId} className="font-normal text-on-surface text-sm">
            罫線だけの行（--- や ＊＊＊）でも分ける
          </Label>
          <Switch
            id={sepId}
            checked={options.separators}
            onCheckedChange={(v) => actions.setOptions({ separators: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={keepId} className="font-normal text-on-surface text-sm">
            見出し行を本文にも残す
          </Label>
          <Switch
            id={keepId}
            checked={options.keepHeadingInBody}
            onCheckedChange={(v) => actions.setOptions({ keepHeadingInBody: v })}
          />
        </div>
      </fieldset>
    </div>
  )
}
