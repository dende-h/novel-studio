import { useEffect, useId, useState } from 'react'
import type { GlossaryEntry } from '@/core/schema'
import { thumbnailToDataUrl } from '@/ui/_utils/imageResizer'
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
import { Textarea } from '@/ui/components/ui/textarea'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

/** 図鑑カテゴリの選択肢（プルダウンで固定）。既存データの自由入力値は編集時のみ選択肢に含めて保全する。 */
export const GLOSSARY_CATEGORIES = ['人物', '場所', '用語', '世界観', 'アイテム'] as const

export interface GlossaryFormValues {
  name: string
  aliases: string[]
  category: string
  reading: string
  summary: string
  /** サムネ画像の data URL。空文字 '' は未設定／削除を表す。 */
  thumbnail: string
}

interface GlossaryEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** create=新規作成 / edit=編集（名前の変更も本ダイアログで行う＝旧名は自動で別名に残る）。 */
  mode: 'create' | 'edit'
  /** create 時の name プリフィルや edit 時の現在値。 */
  initial?: Partial<GlossaryEntry>
  /** 確定。衝突など失敗時は reject すると、ダイアログを閉じずにエラーを表示する。 */
  onSubmit: (values: GlossaryFormValues) => Promise<void> | void
}

/** 別名入力（カンマ／読点／改行区切り）を配列へ。trim・空除去・重複除去。 */
function parseAliases(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,、\n]/)) {
    const a = part.trim()
    if (a !== '' && !out.includes(a)) out.push(a)
  }
  return out
}

/**
 * 図鑑 entry の作成／編集ダイアログ。
 * - 編集でも名前を変更できる（旧名は renameEntry が自動で別名へ退避し、本文の参照は解決され続ける）。
 * - カテゴリは固定リストのプルダウン。既存の自由入力値は選択肢へ含めて壊さない。
 * - 衝突（同名）時は onSubmit が reject し、ダイアログを保ったままエラー文言を表示する。
 */
export function GlossaryEntryForm({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
}: GlossaryEntryFormProps) {
  const uid = useId()
  const [name, setName] = useState('')
  const [reading, setReading] = useState('')
  const [aliases, setAliases] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [thumbnail, setThumbnail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)

  // 開くたびに初期値へ同期する。
  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setReading(initial?.reading ?? '')
    setAliases((initial?.aliases ?? []).join('、'))
    setCategory(initial?.category ?? '')
    setSummary(initial?.summary ?? '')
    setThumbnail(initial?.thumbnail ?? '')
    setError(null)
    setBusy(false)
    setImageBusy(false)
  }, [open, initial])

  // 選択画像を 256 正方形クロップの JPEG data URL にして state へ。失敗は error 表示。
  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    setImageBusy(true)
    setError(null)
    try {
      setThumbnail(await thumbnailToDataUrl(file))
    } catch {
      setError('画像の読み込みに失敗しました')
    } finally {
      setImageBusy(false)
    }
  }

  const isEdit = mode === 'edit'
  const canSubmit = name.trim().length > 0

  // 既存データに固定リスト外のカテゴリ（旧・自由入力）があれば選択肢に含めて保全する。
  const legacyCategory =
    (initial?.category ?? '') !== '' &&
    !(GLOSSARY_CATEGORIES as readonly string[]).includes(initial?.category ?? '')
      ? (initial?.category as string)
      : null

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        aliases: parseAliases(aliases),
        category: category.trim(),
        reading: reading.trim(),
        summary: summary.trim(),
        thumbnail,
      })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-on-surface">
            {isEdit ? '図鑑項目を編集' : '図鑑に登録'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit
              ? '図鑑項目の内容を編集します。'
              : '本文に [[名前]] で参照できる項目を作成します。'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-name`}>名前</Label>
              <Input
                id={`${uid}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：ユグドラシル"
                autoFocus={!isEdit}
              />
            </div>
            {isEdit ? (
              <p className="rounded-md bg-accent px-3 py-2.5 text-[12px] text-primary leading-relaxed">
                名前を変えても大丈夫です。旧名は自動で別名に残り、本文中の参照はそのまま解決されます。
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`${uid}-reading`}>読み（任意）</Label>
                <Input
                  id={`${uid}-reading`}
                  value={reading}
                  onChange={(e) => setReading(e.target.value)}
                  placeholder="ゆぐどらしる"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${uid}-category`}>カテゴリ</Label>
                <select
                  id={`${uid}-category`}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-surface-container-lowest px-3 font-sans text-on-surface text-sm outline-none transition-colors focus:border-primary"
                >
                  <option value="">未分類</option>
                  {GLOSSARY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {legacyCategory ? <option value={legacyCategory}>{legacyCategory}</option> : null}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-aliases`}>別名（読点区切り・任意）</Label>
              <Input
                id={`${uid}-aliases`}
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="世界樹、ワールドツリー"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-summary`}>概要（任意）</Label>
              <Textarea
                id={`${uid}-summary`}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="一覧やパネルに表示される説明"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-thumbnail`}>サムネイル画像（任意）</Label>
              <div className="flex items-center gap-3">
                {thumbnail ? (
                  <ZoomableImage
                    src={thumbnail}
                    alt={name.trim() ? `${name.trim()}のサムネイル` : 'サムネイル'}
                    className="size-16 rounded-md border border-outline-variant/30 object-cover"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-outline-variant/30 border-dashed text-on-surface-variant/40 text-xs">
                    なし
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <input
                    id={`${uid}-thumbnail`}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      void onPickImage(e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="block w-full text-on-surface-variant text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground file:text-sm hover:file:bg-secondary/80"
                  />
                  <div className="flex items-center gap-3 text-on-surface-variant/70 text-xs">
                    <span>{imageBusy ? '処理中…' : '正方形に切り抜いて保存'}</span>
                    {thumbnail ? (
                      <button
                        type="button"
                        onClick={() => setThumbnail('')}
                        className="text-destructive hover:underline"
                      >
                        削除
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={!canSubmit || busy || imageBusy}>
              {isEdit ? '保存する' : '作成'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
