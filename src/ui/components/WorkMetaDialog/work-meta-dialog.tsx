import { useEffect, useState } from 'react'
import { coverToDataUrl } from '@/ui/_utils/imageResizer'
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

export interface WorkMetaValues {
  title: string
  author: string
  description: string
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
  const [title, setTitle] = useState(initial.title ?? '')
  const [author, setAuthor] = useState(initial.author ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [coverImage, setCoverImage] = useState(initial.coverImage ?? '')
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  // 開くたびに最新の初期値へ同期する。
  useEffect(() => {
    if (open) {
      setTitle(initial.title ?? '')
      setAuthor(initial.author ?? '')
      setDescription(initial.description ?? '')
      setCoverImage(initial.coverImage ?? '')
      setImageBusy(false)
      setImageError(null)
    }
  }, [open, initial.title, initial.author, initial.description, initial.coverImage])

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
      title: title.trim(),
      author: author.trim(),
      description: description.trim(),
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
            電子書籍（EPUB）に埋め込まれる作品のメタ情報を編集します。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="space-y-4"
        >
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
            <Label htmlFor="work-meta-description">あらすじ</Label>
            <Textarea
              id="work-meta-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="作品の概要・あらすじ（任意）"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="work-meta-cover">表紙画像</Label>
            <div className="flex items-start gap-3">
              {coverImage ? (
                <img
                  src={coverImage}
                  alt="表紙のプレビュー"
                  className="h-24 w-auto max-w-[6rem] shrink-0 rounded-md border border-outline-variant/30 object-contain"
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
                {imageError ? <span className="text-destructive text-xs">{imageError}</span> : null}
              </div>
            </div>
          </div>
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
