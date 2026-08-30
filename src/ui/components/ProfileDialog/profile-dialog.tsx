import { UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { normalizeDisplayName, validateDisplayName } from '@/core/board/name'
import { BOARD_LIMITS } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { boardErrorMessage } from '@/ui/_api/board'
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
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

export interface ProfileFormValues {
  penName: string
  /** アバター画像の data URL。空文字 '' は未設定／削除を表す。 */
  avatar: string
}

/** 保存の結果。失敗は**そのまま画面に出せる日本語**で返す（重複・予約語・通信断）。 */
export type ProfileSubmitResult = { ok: true } | { ok: false; message: string }

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集前の値（未設定は空文字で渡す） */
  initial: ProfileFormValues
  /**
   * 保存する。**サインイン中はアカウントの表示名（掲示板）も同じ名前になる**ので、
   * 重複などで失敗しうる。`{ ok: false }` を返すとダイアログは閉じず、入力も消さない。
   */
  onSubmit: (values: ProfileFormValues) => Promise<ProfileSubmitResult>
  /**
   * サインイン中か。**名前の使われ方の説明を出し分ける**ためだけに使う
   *（サインインしていれば掲示板の表示名にもなる）。
   */
  signedIn?: boolean
}

/**
 * 作者プロフィール（ペンネーム・アバター）の編集ダイアログ。
 *
 * ここで決めたペンネームは**アカウントのペンネーム**になる（`src/ui/hooks/use-pen-name.ts`）。
 * ヘッダ・サイドバーの表示、これから作る作品の著者、そしてサインイン中なら掲示板の
 * 表示名まで、同じ 1 つの名前で揃う。表示名を変える場所はここ 1 か所だけにしてある
 *（掲示板の初回投稿で出る `NameDialog` は「まだ決めていない人」への入口で、
 * 決め直す場所ではない）。
 *
 * 名前の判定は掲示板と**同じ関数**（`validateDisplayName`）を通す。ここだけ緩いと、
 * 保存できたのに掲示板で弾かれる名前が生まれる。
 */
export function ProfileDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  signedIn = false,
}: ProfileDialogProps) {
  const errorId = useId()
  const [penName, setPenName] = useState(initial.penName)
  const [avatar, setAvatar] = useState(initial.avatar)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 開いた瞬間（閉→開の遷移）だけ最新の初期値へ同期する。表示中は initial の変化に追従しない
  // （自動同期の pull 後に store.init() がプロフィールを読み直しても、入力途中の値を巻き戻さない）。
  const initialRef = useRef(initial)
  initialRef.current = initial
  useEffect(() => {
    if (open) {
      const init = initialRef.current
      setPenName(init.penName)
      setAvatar(init.avatar)
      setImageBusy(false)
      setImageError(null)
      setSaving(false)
      setSaveError(null)
    }
  }, [open])

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

  // 数えるのは保存される形（正規化後）。生の文字数を出すと、全角空白やゼロ幅文字を
  // 含む名前で「24文字なのに保存できない」が起きる（NameDialog と同じ数え方）。
  const count = [...normalizeDisplayName(penName)].length
  const checked = validateDisplayName(penName)
  // 空欄は「未設定に戻す」＝正当な操作なので、ここでは咎めない。
  const localError = penName.trim() === '' || checked.ok ? null : boardErrorMessage(checked.reason)
  const error = localError ?? saveError

  const submit = async () => {
    if (saving || localError !== null) return
    setSaving(true)
    setSaveError(null)
    // 呼び出し側が投げても入力を巻き上げない（書きかけのアバターごと消えるのを防ぐ）。
    const result = await onSubmit({ penName: penName.trim(), avatar }).catch(() => ({
      ok: false as const,
      message: boardErrorMessage('network'),
    }))
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">プロフィール</DialogTitle>
          <DialogDescription>
            {signedIn
              ? 'ペンネームは、これから作る作品の著者と、掲示板の表示名になります。変えると、これまでの書き込みも新しい名前で表示されます。公開サイトの作者名は別の設定なので、ここでは変わりません。'
              : 'ペンネームとアバターを登録します。ペンネームは新しい作品の著者に既定で入ります。'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          // 手元の判定文言（掲示板と同じ）を出したいので、ブラウザ既定の検証は使わない。
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="profile-pen-name">ペンネーム</Label>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    count > BOARD_LIMITS.displayName ? 'text-error' : 'text-on-surface-variant/70',
                  )}
                >
                  {count}/{BOARD_LIMITS.displayName}
                </span>
              </div>
              <Input
                id="profile-pen-name"
                value={penName}
                onChange={(e) => {
                  setPenName(e.target.value)
                  // 名前を書き換えたら、前の往復で返った「すでに使われています」は用済み。
                  setSaveError(null)
                }}
                maxLength={BOARD_LIMITS.displayName * 2}
                placeholder="あなたの筆名（任意）"
                aria-invalid={error !== null}
                aria-describedby={error !== null ? errorId : undefined}
                autoFocus
              />
              {error !== null ? (
                <p id={errorId} role="alert" className="text-error text-sm">
                  {error}
                </p>
              ) : signedIn ? (
                <p className="text-on-surface-variant text-xs leading-5">
                  本名など、知られたくないものは使わないでください。
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-avatar">アバター</Label>
              <div className="flex items-start gap-3">
                {avatar ? (
                  <ZoomableImage
                    src={avatar}
                    alt={penName.trim() ? `${penName.trim()}のアバター` : 'アバター'}
                    className="size-16 rounded-full border border-outline-variant/30 object-cover"
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
              disabled={saving}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={imageBusy || saving || localError !== null}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
