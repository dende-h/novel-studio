import { useEffect, useRef, useState } from 'react'
import { MAX_DESCRIPTION_LENGTH, MAX_SYNOPSIS_LENGTH, type WorkFormat } from '@/core/schema'
import { coverToDataUrl } from '@/ui/_utils/imageResizer'
import { FieldHelp } from '@/ui/components/FieldHelp/field-help'
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

export interface WorkMetaValues {
  format: WorkFormat
  title: string
  author: string
  description: string
  /** 脚本の梗概（結末までのあらすじ）。空文字 '' は未設定／削除を表す。 */
  synopsis: string
  /** 表紙画像の data URL。空文字 '' は未設定／削除を表す。 */
  coverImage: string
}

interface WorkMetaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集前の値（未設定は空文字で渡す） */
  initial: Partial<WorkMetaValues>
  onSubmit: (values: WorkMetaValues) => void
}

/** 作品メタ（タイトル・著者・あらすじ）の編集ダイアログ。EPUB のメタ情報に反映される。 */
export function WorkMetaDialog({ open, onOpenChange, initial, onSubmit }: WorkMetaDialogProps) {
  const [format, setFormat] = useState<WorkFormat>(initial.format ?? 'novel')
  const [title, setTitle] = useState(initial.title ?? '')
  const [author, setAuthor] = useState(initial.author ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [synopsis, setSynopsis] = useState(initial.synopsis ?? '')
  const [coverImage, setCoverImage] = useState(initial.coverImage ?? '')
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  // 開いた瞬間（閉→開の遷移）だけ最新の初期値へ同期する。表示中は initial の変化に追従しない
  // （自動同期の pull 等で親が再レンダーされても、入力途中の値を巻き戻さない）。
  const initialRef = useRef(initial)
  initialRef.current = initial
  useEffect(() => {
    if (open) {
      const init = initialRef.current
      setFormat(init.format ?? 'novel')
      setTitle(init.title ?? '')
      setAuthor(init.author ?? '')
      setDescription(init.description ?? '')
      setSynopsis(init.synopsis ?? '')
      setCoverImage(init.coverImage ?? '')
      setImageBusy(false)
      setImageError(null)
    }
  }, [open])

  const canSubmit = title.trim().length > 0

  // 選択画像を比率維持・長辺1400の JPEG data URL にして state へ。失敗は表示。
  const onPickCover = async (file: File | undefined) => {
    if (!file) return
    setImageBusy(true)
    setImageError(null)
    try {
      setCoverImage(await coverToDataUrl(file))
    } catch {
      setImageError('画像の読み込みに失敗しました')
    } finally {
      setImageBusy(false)
    }
  }

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      format,
      title: title.trim(),
      author: author.trim(),
      description: description.trim(),
      // 小説へ戻したときも梗概は消さない（形式を行き来しても入力を失わない）。
      synopsis: synopsis.trim(),
      coverImage,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">作品情報</DialogTitle>
          <DialogDescription>
            作品の情報を編集します。EPUB やコトノハ-grove- に反映されます。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-2">
              <Label htmlFor="work-meta-title">タイトル</Label>
              <Input
                id="work-meta-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="作品タイトル"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-meta-author">著者</Label>
              <Input
                id="work-meta-author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="ペンネームなど（任意）"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="work-meta-description">あらすじ</Label>
                <span
                  className={`text-xs tabular-nums ${description.length >= MAX_DESCRIPTION_LENGTH ? 'text-destructive' : 'text-on-surface-variant/50'}`}
                >
                  {description.length}/{MAX_DESCRIPTION_LENGTH}
                </span>
              </div>
              <Textarea
                id="work-meta-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="作品の概要・あらすじ（任意）"
                rows={4}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="flex items-center gap-1 text-sm font-medium">
                形式
                <FieldHelp title="形式">
                  <p>脚本にすると、行頭の書き方で柱・ト書き・セリフを見分けて表示します。</p>
                  <ul className="list-disc pl-5">
                    <li>○で始まる行 → 柱（場所と時間）</li>
                    <li>行頭に名前、そのあとに「」が続く行 → セリフ</li>
                    <li>それ以外の行（行頭を空けた行を含む） → ト書き（自動で 3 字下がります）</li>
                  </ul>
                  <p>
                    本文の文字はそのままです。プレビューは原稿用紙（20字×20行）になり、書き出しは
                    Word かテキストです（EPUB・なろう・カクヨムは小説だけ）。コトノハ-grove-
                    の表示も脚本の体裁になります。
                  </p>
                </FieldHelp>
              </legend>
              <div className="flex gap-6">
                {(['novel', 'script'] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="work-format"
                      value={value}
                      checked={format === value}
                      onChange={() => setFormat(value)}
                    />
                    {value === 'novel' ? '小説' : '脚本'}
                  </label>
                ))}
              </div>
            </fieldset>
            {format === 'script' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="work-meta-synopsis" className="flex items-center gap-1">
                    梗概
                    <FieldHelp title="梗概">
                      <p>
                        脚本を提出するときに付ける、結末まで書いたあらすじです。募集要項の指定に合わせ、400〜
                        {MAX_SYNOPSIS_LENGTH} 字が目安です。
                      </p>
                      <p>
                        上の「あらすじ」は読者向け（コトノハ-grove- や EPUB
                        に出ます）で、梗概は脚本の書き出し（Word・テキスト）にだけ載ります。
                      </p>
                    </FieldHelp>
                  </Label>
                  <span
                    className={`text-xs tabular-nums ${synopsis.length >= MAX_SYNOPSIS_LENGTH ? 'text-destructive' : 'text-on-surface-variant/50'}`}
                  >
                    {synopsis.length}/{MAX_SYNOPSIS_LENGTH}
                  </span>
                </div>
                <Textarea
                  id="work-meta-synopsis"
                  value={synopsis}
                  onChange={(e) => setSynopsis(e.target.value)}
                  placeholder="結末まで書いた、提出用のあらすじ（任意）"
                  rows={6}
                  maxLength={MAX_SYNOPSIS_LENGTH}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="work-meta-cover">表紙画像</Label>
              <div className="flex items-start gap-3">
                {coverImage ? (
                  <ZoomableImage
                    src={coverImage}
                    alt={title.trim() ? `${title.trim()}の表紙` : '表紙'}
                    className="h-24 w-auto max-w-[6rem] rounded-md border border-outline-variant/30 object-contain"
                  />
                ) : (
                  <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md border border-outline-variant/30 border-dashed text-on-surface-variant/40 text-xs">
                    なし
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <input
                    id="work-meta-cover"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      void onPickCover(e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="block w-full text-on-surface-variant text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground file:text-sm hover:file:bg-secondary/80"
                  />
                  <div className="flex items-center gap-3 text-on-surface-variant/70 text-xs">
                    <span>
                      {imageBusy ? '処理中…' : 'EPUB に埋め込む表紙（縦横比はそのまま・任意）'}
                    </span>
                    {coverImage ? (
                      <button
                        type="button"
                        onClick={() => setCoverImage('')}
                        className="text-destructive hover:underline"
                      >
                        削除
                      </button>
                    ) : null}
                  </div>
                  {imageError ? (
                    <span className="text-destructive text-xs">{imageError}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-primary"
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={!canSubmit || imageBusy}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
