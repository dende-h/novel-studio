import { useEffect, useId, useState } from 'react'
import type { GlossaryEntry } from '@/core/schema'
import { thumbnailToDataUrl } from '@/ui/_utils/imageResizer'
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
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'

export interface GlossaryFormValues {
  name: string
  aliases: string[]
  category: string
  reading: string
  summary: string
  body: string
  /** サムネ画像の data URL。空文字 '' は未設定／削除を表す。 */
  thumbnail: string
}

interface GlossaryEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** create=新規作成（name 編集可）/ edit=詳細編集（name は読み取り専用＝改名は別操作）。 */
  mode: 'create' | 'edit'
  /** create 時の name プリフィルや edit 時の現在値。 */
  initial?: Partial<GlossaryEntry>
  /** カテゴリ入力のオートコンプリート候補（既存カテゴリ）。 */
  categories?: string[]
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
 * 辞書 entry の作成／詳細編集ダイアログ（WorkMetaDialog パターン）。
 * - name は create でのみ編集可。edit では読み取り専用にし、改名は RenameEntryDialog に委ねる
 *   （改名は旧名の自動エイリアス退避・本文一括書換を伴うため、フィールド編集と分離する）。
 * - 衝突（同名）時は onSubmit が reject し、ダイアログを保ったままエラー文言を表示する。
 */
export function GlossaryEntryForm({
  open,
  onOpenChange,
  mode,
  initial,
  categories = [],
  onSubmit,
}: GlossaryEntryFormProps) {
  const uid = useId()
  const [name, setName] = useState('')
  const [reading, setReading] = useState('')
  const [aliases, setAliases] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
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
    setBody(initial?.body ?? '')
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
  const canSubmit = isEdit || name.trim().length > 0

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
        body: body.trim(),
        thumbnail,
      })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
      setBusy(false)
    }
  }

  const listId = `${uid}-categories`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">
            {isEdit ? '図鑑項目を編集' : '図鑑に追加'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? '名前以外の項目を編集します。改名は「改名」から行います。'
              : '本文に [[名前]] で参照できる項目を作成します。詳細は後から編集できます。'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor={`${uid}-name`}>名前</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="アリス"
              readOnly={isEdit}
              aria-readonly={isEdit}
              autoFocus={!isEdit}
            />
            {isEdit ? (
              <p className="text-on-surface-variant text-xs">名前の変更は「改名」から</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-reading`}>読み</Label>
              <Input
                id={`${uid}-reading`}
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                placeholder="ありす（任意）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-category`}>カテゴリ</Label>
              <Input
                id={`${uid}-category`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="人物・地名など（任意）"
                list={categories.length > 0 ? listId : undefined}
              />
              {categories.length > 0 ? (
                <datalist id={listId}>
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-aliases`}>別名</Label>
            <Input
              id={`${uid}-aliases`}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="Alice、姫君（カンマ区切り・任意）"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-summary`}>概要</Label>
            <Textarea
              id={`${uid}-summary`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="一覧やピークに表示される短い説明（任意）"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-body`}>詳細メモ</Label>
            <Textarea
              id={`${uid}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="設定・覚書など（任意）"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-thumbnail`}>サムネイル画像</Label>
            <div className="flex items-center gap-3">
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt="サムネイルのプレビュー"
                  className="size-16 shrink-0 rounded-md border border-outline-variant/30 object-cover"
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
                  <span>{imageBusy ? '処理中…' : '正方形に切り抜いて保存（任意）'}</span>
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-primary"
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={!canSubmit || busy || imageBusy}>
              {isEdit ? '保存' : '作成'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
