import { BookOpen, Lock } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { publicTextOf } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { thumbnailToDataUrl } from '@/ui/_utils/imageResizer'
import { CommitTextarea } from '@/ui/components/NotationField/commit-textarea'
import { NotationHelpButton } from '@/ui/components/NotationField/notation-help'
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

/**
 * 用語集カテゴリの選択肢（プルダウンで固定）。既存データの自由入力値は編集時のみ選択肢に含めて保全する。
 * 「世界観」は置かない：作品全体の設定・決め事はプロットの世界観設定が受け持つ器なので、
 * 同じ言葉が二か所にあると「どちらに書くのか」が毎回迷いになる。
 */
export const GLOSSARY_CATEGORIES = ['人物', '場所', '組織', '用語', 'アイテム', '生物'] as const

export interface GlossaryFormValues {
  name: string
  aliases: string[]
  category: string
  reading: string
  /** 公開情報（読者に見える説明文）。概要と旧・詳細はこの 1 欄に統合（D-GLOS-PUBLIC-ONE）。 */
  summary: string
  /** 作者メモ（公開バンドルから落とされる非公開欄）。 */
  authorNote: string
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
  /** 用語集（公開情報・作者メモの @ / [[ サジェスト候補）。省略ならサジェストしない。 */
  glossary?: GlossaryEntry[]
  /** 候補に無い語をその場で用語集に登録する（作成した名前を返す。失敗は null）。 */
  onCreateEntry?: (name: string) => Promise<string | null>
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
 * 用語集の項目の作成／編集ダイアログ。
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
  glossary,
  onCreateEntry,
}: GlossaryEntryFormProps) {
  const uid = useId()
  const [name, setName] = useState('')
  const [reading, setReading] = useState('')
  const [aliases, setAliases] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [authorNote, setAuthorNote] = useState('')
  const [thumbnail, setThumbnail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)

  // 開いた瞬間（閉→開の遷移）だけ初期値へ同期する。表示中は initial の変化に追従しない：
  // 自動同期（pull 後の store.init()）等で親が再レンダーされたときに、入力途中の
  // フィールドが初期値へ巻き戻って「入力中のデータが消える」事故を防ぐ。
  const initialRef = useRef(initial)
  initialRef.current = initial
  useEffect(() => {
    if (!open) return
    const init = initialRef.current
    setName(init?.name ?? '')
    setReading(init?.reading ?? '')
    setAliases((init?.aliases ?? []).join('、'))
    setCategory(init?.category ?? '')
    // 旧データ（概要＋詳細）は結合して 1 欄で開く＝保存すると一本化される。
    setSummary(init ? publicTextOf(init) : '')
    setAuthorNote(init?.authorNote ?? '')
    setThumbnail(init?.thumbnail ?? '')
    setError(null)
    setBusy(false)
    setImageBusy(false)
  }, [open])

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
        authorNote: authorNote.trim(),
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
            {isEdit ? '用語を編集' : '用語集に登録'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit
              ? '用語集の項目の内容を編集します。'
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
            {/* 狭幅で 2 列固定にすると読み・カテゴリとも入力欄が潰れるので 1 列へ落とす。 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  className="h-9 w-full rounded-md border border-input bg-surface-container-lowest px-3 font-sans text-base text-on-surface outline-none transition-colors focus:border-primary md:text-sm"
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
              {/* ⓘはダイアログを開くボタンなので label の外に置く（label 内だと入力への
                  フォーカス移譲とぶつかる）。 */}
              <div className="flex items-center gap-2">
                <Label htmlFor={`${uid}-summary`} className="gap-2">
                  公開情報（任意）
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-container px-2 py-0.5 font-medium text-[10.5px] text-on-primary-container">
                    <BookOpen className="size-2.5" />
                    読者に見えます
                  </span>
                </Label>
                <NotationHelpButton />
              </div>
              <CommitTextarea
                id={`${uid}-summary`}
                ariaLabel="公開情報（任意）"
                value={summary}
                onCommit={setSummary}
                placeholder="一行の要約から、来歴・見た目などの詳しい説明まで、読者に見せる文をここへ"
                glossary={glossary}
                onCreateEntry={onCreateEntry}
                grow={false}
                className="min-h-24 max-h-48 text-[13px]"
              />
              <p className="text-[11.5px] text-on-surface-variant/70 leading-relaxed">
                公開サイトへ投稿すると読者にも見えます（その用語が出てくる話まで読んだ読者だけに
                開きます）。@ または [[ で用語集を呼び出せます。
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${uid}-authorNote`} className="gap-2">
                  作者メモ（任意）
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 font-medium text-[10.5px] text-on-secondary-container">
                    <Lock className="size-2.5" />
                    公開されません
                  </span>
                </Label>
                <NotationHelpButton />
              </div>
              <CommitTextarea
                id={`${uid}-authorNote`}
                ariaLabel="作者メモ（任意）"
                value={authorNote}
                onCommit={setAuthorNote}
                placeholder="この人物の正体、この場所で後に起きること——まだ読者に見せないこと"
                glossary={glossary}
                onCreateEntry={onCreateEntry}
                grow={false}
                className="min-h-20 max-h-40 text-[13px]"
              />
              <p className="text-[11.5px] text-on-surface-variant/70 leading-relaxed">
                この欄だけは投稿時に取り除かれます。作品全体の決め事や設定ルールは、プロットの
                「世界観設定」へ書くとまとまります。
              </p>
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
