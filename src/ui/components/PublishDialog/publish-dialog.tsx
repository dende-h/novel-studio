import { CloudUpload, ExternalLink, FileText, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  PLATFORM_GENRES,
  PLATFORM_MAX_DESCRIPTION_LENGTH,
  PLATFORM_MAX_TAG_LENGTH,
  PLATFORM_MAX_TAGS,
  type Work,
  type WorkPlatform,
} from '@/core/schema'
import { cn } from '@/lib/utils'
import {
  canPublishPublicly,
  describePublishBlocked,
  type PublishResult,
  publishWorkToPlatform,
} from '@/ui/_api/publish'
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
import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'

/** 公開サイト上での見え方。契約の `platform.visibility` と同じ 2 値。 */
type Visibility = 'draft' | 'public'

/** 投稿の確定内容（作品へ保存して、次に開いたときと再投稿に引き継ぐ）。 */
export interface PublishPersistValues {
  description: string
  platform: WorkPlatform
}

interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 投稿対象。null なら操作できない。 */
  work: Work | null
  /** Clerk セッション JWT。未サインインなら null を返す。 */
  getToken: () => Promise<string | null>
  /** 入力内容と投稿結果を作品へ保存する。 */
  onPersist: (workId: string, values: PublishPersistValues) => void
}

/** 自由タグの入力（読点／カンマ／改行区切り）を配列へ。trim・空除去・重複除去。 */
export function parseTags(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,、\n]/)) {
    const t = part.trim()
    if (t !== '' && !out.includes(t)) out.push(t)
  }
  return out
}

/** タグが公開サイトの受け入れ条件に収まっているか。収まらなければ理由を返す。 */
export function validateTags(tags: string[]): string | null {
  if (tags.length > PLATFORM_MAX_TAGS) {
    return `タグは${PLATFORM_MAX_TAGS}件までです（いま${tags.length}件）`
  }
  if (tags.some((t) => t.length > PLATFORM_MAX_TAG_LENGTH)) {
    return `タグは1件あたり${PLATFORM_MAX_TAG_LENGTH}字までです`
  }
  return null
}

/**
 * 公開サイト（novel platform）への投稿ダイアログ。
 *
 * コトノハで書いて、ここで公開／下書きを決めるだけで投稿が完結するようにする。
 * 誓約2つ（全年齢・一次創作）は規約同意なので既定はオフ。揃わないと「公開して投稿」は押せず、
 * 押せない理由をその場に出す（黙って無効化しない）。下書き投稿は誓約なしでも行える。
 */
export function PublishDialog({
  open,
  onOpenChange,
  work,
  getToken,
  onPersist,
}: PublishDialogProps) {
  const uid = useId()
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [isCompleted, setIsCompleted] = useState(false)
  const [kind, setKind] = useState<'serial' | 'oneshot'>('serial')
  const [allAges, setAllAges] = useState(false)
  const [original, setOriginal] = useState(false)
  /** 送信中の宛先（押されたボタンにだけスピナーを出す）。null なら送信していない。 */
  const [pending, setPending] = useState<Visibility | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)

  const prevOpen = useRef(false)

  // 開いた瞬間だけ作品の現在値へ同期する。誓約は「作者自身が前に立てた宣言」なので保存済みなら
  // 復元し、記録が無ければオフのまま（＝こちらから勝手にオンにはしない）。
  // 開いている間の work 変化では同期しない：投稿成功→作品へ保存で work が差し替わるため、
  // 同期してしまうと表示したばかりの投稿結果と導線が消えてしまう。
  useEffect(() => {
    if (open && !prevOpen.current) {
      const p = work?.platform
      setDescription(work?.description ?? '')
      setGenre(p?.genre ?? '')
      setTagsText((p?.tags ?? []).join('、'))
      setIsCompleted(p?.isCompleted ?? false)
      setKind(p?.kind ?? 'serial')
      setAllAges(p?.declaredAllAges === true)
      setOriginal(p?.declaredOriginal === true)
      setPending(null)
      setResult(null)
    }
    prevOpen.current = open
  }, [open, work])

  const tags = parseTags(tagsText)
  const tagError = validateTags(tags)
  const declarationsOk = canPublishPublicly({
    declaredAllAges: allAges,
    declaredOriginal: original,
  })
  const canSubmit = work !== null && pending === null && tagError === null

  const submit = async (visibility: Visibility) => {
    if (!work || !canSubmit) return
    setPending(visibility)
    setResult(null)

    // 契約ぶんは毎回この画面の入力から作り直す（前回の値をマージすると、ジャンルを
    // 「未選択」に戻したときに古い値が残ってしまう）。ローカル専用の記録だけ引き継ぐ。
    const { lastPublishedAt, workUrl, manageUrl } = work.platform ?? {}
    const platform: WorkPlatform = {
      ...(genre !== '' ? { genre } : {}),
      tags,
      declaredAllAges: allAges,
      declaredOriginal: original,
      visibility,
      isCompleted,
      kind,
      ...(lastPublishedAt !== undefined ? { lastPublishedAt } : {}),
      ...(workUrl ? { workUrl } : {}),
      ...(manageUrl ? { manageUrl } : {}),
    }
    const desc = description.trim()
    const res = await publishWorkToPlatform(getToken, { ...work, description: desc, platform })

    if (res.ok) {
      onPersist(work.id, {
        description: desc,
        platform: {
          ...platform,
          // 誓約欠けや運営の非表示で公開されないことがあるので、記録は「実際にどうなったか」に合わせる。
          visibility: res.published ? 'public' : 'draft',
          lastPublishedAt: Date.now(),
          manageUrl: res.manageUrl,
          ...(res.workUrl ? { workUrl: res.workUrl } : {}),
        },
      })
    }
    setResult(res)
    setPending(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-primary">
            <CloudUpload className="size-5" aria-hidden />
            公開サイトへ投稿
          </DialogTitle>
          <DialogDescription>
            {work?.title ?? '作品'} を読者向けサイトへ送ります。投稿しても、
            <strong>公開するかどうかはここで選べます</strong>。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${uid}-description`}>あらすじ</Label>
              <span
                className={cn(
                  'text-xs tabular-nums',
                  description.length >= PLATFORM_MAX_DESCRIPTION_LENGTH
                    ? 'text-destructive'
                    : 'text-on-surface-variant/50',
                )}
              >
                {description.length}/{PLATFORM_MAX_DESCRIPTION_LENGTH}
              </span>
            </div>
            <Textarea
              id={`${uid}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="読者が最初に読む紹介文（任意）"
              rows={4}
              maxLength={PLATFORM_MAX_DESCRIPTION_LENGTH}
              className="max-h-40"
            />
          </div>

          {/* 狭幅で 2 列固定にすると選択欄が潰れるので 1 列へ落とす（他ダイアログと同じ扱い）。 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-genre`}>ジャンル</Label>
              <select
                id={`${uid}-genre`}
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-surface-container-lowest px-3 font-sans text-base text-on-surface outline-none transition-colors focus:border-primary md:text-sm"
              >
                <option value="">未選択</option>
                {PLATFORM_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <span className="font-medium text-sm">形式</span>
              <div className="flex gap-2">
                {(['serial', 'oneshot'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm transition-colors',
                      kind === k
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    {k === 'serial' ? '連載' : '読み切り'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${uid}-tags`}>
              タグ（読点区切り・{PLATFORM_MAX_TAGS}件まで・任意）
            </Label>
            <Textarea
              id={`${uid}-tags`}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="異世界、幼馴染、ハッピーエンド"
              rows={2}
              className="max-h-20"
            />
            {tagError ? (
              <p role="alert" className="text-destructive text-xs">
                {tagError}
              </p>
            ) : (
              <p className="text-on-surface-variant/70 text-xs">
                ジャンルに収まらない言葉はタグへ。1件{PLATFORM_MAX_TAG_LENGTH}字まで。
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant/30 p-3">
            <Label htmlFor={`${uid}-completed`} className="font-normal text-on-surface text-sm">
              この作品は完結している
              <span className="mt-0.5 block text-on-surface-variant text-xs">
                完結済みとして読者に伝わります。あとから変えられます。
              </span>
            </Label>
            <Switch
              id={`${uid}-completed`}
              checked={isCompleted}
              onCheckedChange={setIsCompleted}
            />
          </div>

          {/* 誓約（規約同意）。既定オフ・自動チェックはしない。公開の可否だけがこれに依る。 */}
          <fieldset className="space-y-2 rounded-lg border border-outline-variant/30 p-3">
            <legend className="px-1 font-sans text-on-surface-variant text-xs">
              公開するための誓約
            </legend>
            <label className="flex cursor-pointer items-start gap-2 font-sans text-on-surface text-sm">
              <input
                type="checkbox"
                checked={allAges}
                onChange={(e) => setAllAges(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              この作品は<strong>全年齢向け</strong>です。
            </label>
            <label className="flex cursor-pointer items-start gap-2 font-sans text-on-surface text-sm">
              <input
                type="checkbox"
                checked={original}
                onChange={(e) => setOriginal(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              この作品は<strong>自分が書いた一次創作</strong>で、無断転載ではありません。
            </label>
          </fieldset>

          {result ? <PublishResultPanel result={result} /> : null}
        </DialogBody>

        <DialogFooter className="sm:flex-col sm:items-stretch">
          {/* 押せない理由をボタンのそばに出す（黙って無効化しない）。 */}
          {!declarationsOk ? (
            <p className="text-on-surface-variant text-xs sm:text-right">
              公開して投稿するには、上の誓約2つにチェックが必要です。下書きとしてなら今すぐ投稿できます。
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 text-primary"
              onClick={() => void submit('draft')}
              disabled={!canSubmit}
            >
              {pending === 'draft' ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="size-4" aria-hidden />
              )}
              下書きとして投稿
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={() => void submit('public')}
              disabled={!canSubmit || !declarationsOk}
            >
              {pending === 'public' ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <CloudUpload className="size-4" aria-hidden />
              )}
              公開して投稿
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 投稿結果（成功・公開されたか・失敗理由）と、次に開く先の導線。 */
function PublishResultPanel({ result }: { result: PublishResult }) {
  if (!result.ok) {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3">
        <p className="font-sans text-destructive text-sm leading-relaxed">{result.message}</p>
        {result.registerUrl ? (
          <PlatformLink href={result.registerUrl}>作者登録へ進む</PlatformLink>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="font-sans text-on-surface text-sm leading-relaxed">
        {result.published
          ? '公開しました。読者が読める状態です。'
          : result.publishBlocked
            ? describePublishBlocked(result.publishBlocked)
            : '下書きとして投稿しました。まだ読者には見えません。'}
      </p>
      <div className="flex flex-wrap gap-3">
        {result.published && result.workUrl ? (
          <PlatformLink href={result.workUrl}>公開ページを開く</PlatformLink>
        ) : null}
        <PlatformLink href={result.manageUrl}>公開サイトの管理画面を開く</PlatformLink>
      </div>
    </div>
  )
}

/** 公開サイトへの外部リンク（別タブ）。 */
function PlatformLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 font-sans text-primary text-sm hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}
