import { useEffect, useState } from 'react'
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

  // 開くたびに最新の初期値へ同期する。
  useEffect(() => {
    if (open) {
      setTitle(initial.title ?? '')
      setAuthor(initial.author ?? '')
      setDescription(initial.description ?? '')
    }
  }, [open, initial.title, initial.author, initial.description])

  const canSubmit = title.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      author: author.trim(),
      description: description.trim(),
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-primary"
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
