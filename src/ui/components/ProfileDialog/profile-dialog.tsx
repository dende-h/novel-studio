import { UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
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

export interface ProfileFormValues {
  penName: string
  /** アバター画像の data URL。空文字 '' は未設定／削除を表す。 */
  avatar: string
}

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集前の値（未設定は空文字で渡す） */
  initial: ProfileFormValues
  onSubmit: (values: ProfileFormValues) => void
}

/** 作者プロフィール（ペンネーム・アバター）の編集ダイアログ。新規作品の著者既定にも使われる。 */
export function ProfileDialog({ open, onOpenChange, initial, onSubmit }: ProfileDialogProps) {
  const [penName, setPenName] = useState(initial.penName)
  const [avatar, setAvatar] = useState(initial.avatar)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  // 開くたびに最新の初期値へ同期する。
  useEffect(() => {
    if (open) {
      setPenName(initial.penName)
      setAvatar(initial.avatar)
      setImageBusy(false)
      setImageError(null)
    }
  }, [open, initial.penName, initial.avatar])

  // 選択画像を 256 正方形クロップの JPEG data URL にして state へ。失敗は表示。
  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return
    setImageBusy(true)
    setImageError(null)
    try {
      setAvatar(await thumbnailToDataUrl(file))
    } catch {
      setImageError('画像の読み込みに失敗しました')
    } finally {
      setImageBusy(false)
    }
  }

  const submit = () => {
    onSubmit({ penName: penName.trim(), avatar })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">プロフィール</DialogTitle>
          <DialogDescription>
            ペンネームとアバターを登録します。ペンネームは新しい作品の著者に既定で入ります。
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
            <Label htmlFor="profile-pen-name">ペンネーム</Label>
            <Input
              id="profile-pen-name"
              value={penName}
              onChange={(e) => setPenName(e.target.value)}
              placeholder="あなたの筆名（任意）"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-avatar">アバター</Label>
            <div className="flex items-start gap-3">
              {avatar ? (
                <img
                  src={avatar}
                  alt="アバターのプレビュー"
                  className="size-16 shrink-0 rounded-full border border-outline-variant/30 object-cover"
                />
              ) : (
                <div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 border-dashed text-on-surface-variant/40">
                  <UserRound className="size-7" />
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-1.5">
                <input
                  id="profile-avatar"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    void onPickAvatar(e.target.files?.[0])
                    e.target.value = ''
                  }}
                  className="block w-full text-on-surface-variant text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground file:text-sm hover:file:bg-secondary/80"
                />
                <div className="flex items-center gap-3 text-on-surface-variant/70 text-xs">
                  <span>{imageBusy ? '処理中…' : '正方形に切り抜かれます（任意）'}</span>
                  {avatar ? (
                    <button
                      type="button"
                      onClick={() => setAvatar('')}
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
            <Button type="submit" disabled={imageBusy}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
