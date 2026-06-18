import { useEffect, useId, useState } from 'react'
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
import { Switch } from '@/ui/components/ui/switch'

interface RenameEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 改名対象の現在名（初期値）。 */
  currentName: string
  /** 確定。衝突時は reject すると、ダイアログを保ったままエラーを表示する。 */
  onSubmit: (newName: string, opts: { rewriteBody: boolean }) => Promise<void> | void
}

/**
 * 辞書 entry の改名ダイアログ。
 * - 旧名は自動的に別名へ退避され、既存の参照は解決され続ける（renameEntry の責務）。
 * - 「本文の参照も新しい名前へ書き換える」(rewriteBody) を任意で選べる。
 *   OFF なら表示名だけ変わり、本文の [[旧名]] は別名解決で生き続ける。
 */
export function RenameEntryDialog({
  open,
  onOpenChange,
  currentName,
  onSubmit,
}: RenameEntryDialogProps) {
  const uid = useId()
  const [name, setName] = useState(currentName)
  const [rewriteBody, setRewriteBody] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(currentName)
    setRewriteBody(false)
    setError(null)
    setBusy(false)
  }, [open, currentName])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed !== currentName.trim()

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed, { rewriteBody })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '改名に失敗しました')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">項目を改名</DialogTitle>
          <DialogDescription>
            旧名「{currentName}」は別名として残り、既存の参照は解決され続けます。
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
            <Label htmlFor={`${uid}-name`}>新しい名前</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <label
            htmlFor={`${uid}-rewrite`}
            className="flex cursor-pointer items-center justify-between gap-4"
          >
            <span className="text-sm">
              本文中の参照も新しい名前へ書き換える
              <span className="block text-on-surface-variant text-xs">
                OFF なら本文はそのまま（別名で解決）
              </span>
            </span>
            <Switch id={`${uid}-rewrite`} checked={rewriteBody} onCheckedChange={setRewriteBody} />
          </label>
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
            <Button type="submit" disabled={!canSubmit || busy}>
              改名
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
