import { type ReactNode, useEffect, useRef, useState } from 'react'
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

interface TitlePromptDialogProps {
  children?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  placeholder?: string
  defaultValue?: string
  submitLabel?: string
  /** 入力できる文字数の上限。指定すると残りの文字数を出し、超えていれば決定できない。 */
  maxLength?: number
  onSubmit: (value: string) => void
}

/** タイトル入力ダイアログ（window.prompt の置き換え）。空なら defaultValue を採用。 */
export function TitlePromptDialog({
  children,
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  defaultValue = '',
  submitLabel = '作成',
  maxLength,
  onSubmit,
}: TitlePromptDialogProps) {
  const [value, setValue] = useState(defaultValue)

  // 開いた瞬間（閉→開の遷移）だけ defaultValue へ初期化する。表示中は追従しない
  // （自動同期等で親が再レンダーされても入力途中の値を巻き戻さない）。
  const defaultValueRef = useRef(defaultValue)
  defaultValueRef.current = defaultValue
  useEffect(() => {
    if (open) setValue(defaultValueRef.current)
  }, [open])

  // 既存の長いタイトル（上限を入れる前に保存したもの）も開けるよう、入力は切らずに決定だけ止める。
  const length = Array.from(value.trim()).length
  const over = maxLength !== undefined && length > maxLength

  const submit = () => {
    if (over) return
    onSubmit(value.trim() || defaultValue)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
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
              <Label htmlFor="title-prompt-input">{label}</Label>
              <Input
                id="title-prompt-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                aria-invalid={over || undefined}
                aria-describedby={maxLength !== undefined ? 'title-prompt-count' : undefined}
                autoFocus
              />
              {maxLength !== undefined ? (
                <p
                  id="title-prompt-count"
                  className={over ? 'text-destructive text-xs' : 'text-on-surface-variant text-xs'}
                >
                  {over
                    ? `${maxLength}文字までです（いま${length}文字）`
                    : `${length}／${maxLength}文字`}
                </p>
              ) : null}
            </div>
            {children}
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
            <Button type="submit" disabled={over}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
