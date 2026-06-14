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

interface TitlePromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  placeholder?: string
  defaultValue?: string
  submitLabel?: string
  onSubmit: (value: string) => void
}

/** タイトル入力ダイアログ（window.prompt の置き換え）。空なら defaultValue を採用。 */
export function TitlePromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  defaultValue = '',
  submitLabel = '作成',
  onSubmit,
}: TitlePromptDialogProps) {
  const [value, setValue] = useState(defaultValue)

  // 開くたびに defaultValue へ初期化
  useEffect(() => {
    if (open) setValue(defaultValue)
  }, [open, defaultValue])

  const submit = () => {
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
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="title-prompt-input">{label}</Label>
            <Input
              id="title-prompt-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
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
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
