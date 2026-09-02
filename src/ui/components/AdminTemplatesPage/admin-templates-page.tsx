import { ImagePlus, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameTime } from '@/core/game/presets'
import {
  type CatalogBackground,
  type CatalogSprite,
  categoriesOf,
  categoryLabelOf,
  defaultTemplateLabel,
  mergeBackgroundCatalog,
  mergeSpriteCatalog,
  parseTemplateFilename,
  parseTemplateTsv,
  TEMPLATE_TIMES,
  type TemplateEntry,
  type TemplateEntryPatch,
  type TemplateKind,
  type TemplateManifest,
  timeLabelOf,
} from '@/core/game/templates'
import { cn } from '@/lib/utils'
import {
  adminFetchTemplates,
  adminPatchTemplates,
  adminPutTemplate,
} from '@/ui/_api/game-templates'
import {
  gameBgToDataUrl,
  gameSpriteToDataUrl,
  templateThumbToDataUrl,
} from '@/ui/_utils/imageResizer'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import { setTemplateCatalog, templateBgSrc, templateSpriteSrc } from '@/ui/game/template-catalog'

/**
 * 運営テンプレ（背景・立ち絵）の管理ページ（`#/admin/templates`・**staff だけ**・D-GAME-TEMPLATE-CMS）。
 *
 * - 画像をまとめてドロップすると、ファイル名を命名規則で読んでキーと分類を決め、
 *   ブラウザで WebP・サムネ・tone を作ってから 1 枚ずつ送る（同じ名前は置き換え）。
 * - 表示名・分類・時間帯・一覧に出すか は画面で直して「変更を保存」で目録に書く。
 *   改名 AI が返す TSV を貼れば、表示名と分類を一括で入れられる。
 * - 「削除」は無い。一覧から外す（非表示）だけで、既存作品の参照は生かす。
 *
 * 入口は Root（staff のときだけ描く）と設定ページのリンク。一般ユーザーには何も出ない。
 */

interface AdminTemplatesPageProps {
  getToken: () => Promise<string | null>
}

/** 未保存の書き換え（渡した項目だけ・省略は据え置き）。 */
interface Draft {
  label?: string
  category?: string
  /** null ＝ 時間帯を外す */
  time?: GameTime | null
  hidden?: boolean
}

type CategoryDrafts = Record<TemplateKind, Record<string, string>>

const keyOf = (kind: TemplateKind, slug: string) => `${kind}/${slug}`

function upsertEntry(manifest: TemplateManifest, entry: TemplateEntry): TemplateManifest {
  const exists = manifest.entries.some((e) => e.kind === entry.kind && e.slug === entry.slug)
  return {
    ...manifest,
    updatedAt: entry.updatedAt,
    entries: exists
      ? manifest.entries.map((e) => (e.kind === entry.kind && e.slug === entry.slug ? entry : e))
      : [...manifest.entries, entry],
  }
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

export function AdminTemplatesPage({ getToken }: AdminTemplatesPageProps) {
  // null ＝ 読込中、'denied' ＝ 取れなかった（staff でない・通信不良）
  const [manifest, setManifest] = useState<TemplateManifest | 'denied' | null>(null)
  const [tab, setTab] = useState<TemplateKind>('bg')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [categoryDrafts, setCategoryDrafts] = useState<CategoryDrafts>({ bg: {}, sprite: {} })
  const [upload, setUpload] = useState<{ done: number; total: number; current: string } | null>(
    null,
  )
  const [log, setLog] = useState<string[]>([])
  const [tsv, setTsv] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void adminFetchTemplates(getToken).then((m) => {
      if (alive) setManifest(m ?? 'denied')
    })
    return () => {
      alive = false
    }
  }, [getToken])

  const current = manifest && manifest !== 'denied' ? manifest : null

  const backgrounds = useMemo(() => mergeBackgroundCatalog(current), [current])
  const sprites = useMemo(() => mergeSpriteCatalog(current), [current])
  const rows: Array<CatalogBackground | CatalogSprite> = tab === 'bg' ? backgrounds : sprites
  const groups = useMemo(() => categoriesOf(rows), [rows])

  const draftOf = (kind: TemplateKind, slug: string): Draft => drafts[keyOf(kind, slug)] ?? {}
  const setDraft = (kind: TemplateKind, slug: string, patch: Draft) =>
    setDrafts((prev) => ({
      ...prev,
      [keyOf(kind, slug)]: { ...prev[keyOf(kind, slug)], ...patch },
    }))

  const dirty =
    Object.keys(drafts).length > 0 ||
    Object.keys(categoryDrafts.bg).length > 0 ||
    Object.keys(categoryDrafts.sprite).length > 0

  const appendLog = (line: string) => setLog((prev) => [...prev, line])

  /** ドロップ・選択されたファイルを 1 枚ずつ送る。名前が規則に合わないものは飛ばして知らせる。 */
  const handleFiles = async (files: File[]) => {
    if (!current || upload) return
    setNotice(null)
    const jobs = files.map((file) => ({ file, parsed: parseTemplateFilename(file.name) }))
    for (const j of jobs) {
      if (!j.parsed) appendLog(`${j.file.name}：名前が規則に合わないので飛ばしました`)
    }
    const good = jobs.filter(
      (j): j is { file: File; parsed: NonNullable<typeof j.parsed> } => j.parsed !== null,
    )
    if (good.length === 0) return
    setUpload({ done: 0, total: good.length, current: '' })
    let next = current
    for (const { file, parsed } of good) {
      setUpload((u) => (u ? { ...u, current: file.name } : u))
      try {
        const kind = parsed.kind
        const { dataUrl, tone } =
          kind === 'bg' ? await gameBgToDataUrl(file) : await gameSpriteToDataUrl(file)
        const thumbDataUrl = await templateThumbToDataUrl(file, { alpha: kind === 'sprite' })
        const exists = next.entries.some((e) => e.kind === kind && e.slug === parsed.slug)
        const res = await adminPutTemplate(getToken, kind, parsed.slug, {
          dataUrl,
          thumbDataUrl,
          tone,
          // 置き換えなら表示名・分類は据え置き。新規は命名規則から既定を付ける
          ...(exists
            ? {}
            : {
                label: defaultTemplateLabel(parsed, categoryLabelOf(next, kind, parsed.category)),
                category: parsed.category,
                ...(parsed.time ? { time: parsed.time } : {}),
              }),
        })
        if (!res.ok) {
          appendLog(`${file.name}：送れませんでした（${res.error}）`)
        } else {
          next = upsertEntry(next, res.entry)
          setManifest(next)
        }
      } catch {
        appendLog(`${file.name}：画像を読み込めませんでした`)
      }
      setUpload((u) => (u ? { ...u, done: u.done + 1 } : u))
    }
    setUpload(null)
    setTemplateCatalog(next)
    setNotice(`${good.length} 枚を送りました`)
  }

  /** 改名 AI の TSV から表示名・分類を下書きに入れる（保存はまだ）。 */
  const importTsv = () => {
    if (!current) return
    const { rows: parsedRows, skipped } = parseTemplateTsv(tsv)
    let applied = 0
    let unknown = 0
    for (const r of parsedRows) {
      const exists = current.entries.some((e) => e.kind === r.kind && e.slug === r.slug)
      if (!exists) {
        unknown += 1
        continue
      }
      setDraft(r.kind, r.slug, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...(r.category !== undefined ? { category: r.category } : {}),
      })
      applied += 1
    }
    setNotice(
      `${applied} 件に入れました（未保存）${unknown > 0 ? `・まだ画像の無い名前 ${unknown} 件` : ''}${skipped.length > 0 ? `・読めない行 ${skipped.length}` : ''}`,
    )
  }

  const save = async () => {
    if (!current || !dirty) return
    setSaving(true)
    setNotice(null)
    const entries: TemplateEntryPatch[] = Object.entries(drafts)
      .map(([k, d]) => {
        const [kind, slug] = k.split('/') as [TemplateKind, string]
        return { kind, slug, ...d }
      })
      .filter((p) => current.entries.some((e) => e.kind === p.kind && e.slug === p.slug))
    const categories = {
      ...(Object.keys(categoryDrafts.bg).length > 0 ? { bg: categoryDrafts.bg } : {}),
      ...(Object.keys(categoryDrafts.sprite).length > 0 ? { sprite: categoryDrafts.sprite } : {}),
    }
    const next = await adminPatchTemplates(getToken, {
      ...(entries.length > 0 ? { entries } : {}),
      ...(Object.keys(categories).length > 0 ? { categories } : {}),
    })
    setSaving(false)
    if (!next) {
      setNotice('保存できませんでした。通信環境を確認して、もう一度お試しください')
      return
    }
    setManifest(next)
    setDrafts({})
    setCategoryDrafts({ bg: {}, sprite: {} })
    setTemplateCatalog(next)
    setNotice('保存しました')
  }

  if (manifest === null) {
    return (
      <PageLayout title="テンプレ素材の管理" backHref="#/settings" backLabel="設定へ戻る" wide>
        <p className="text-on-surface-variant text-sm">読み込み中…</p>
      </PageLayout>
    )
  }
  if (manifest === 'denied') {
    return (
      <PageLayout title="テンプレ素材の管理" backHref="#/settings" backLabel="設定へ戻る" wide>
        <p className="text-on-surface-variant text-sm">
          このページは表示できません。運営アカウントでサインインしているか確認してください。
        </p>
      </PageLayout>
    )
  }

  const imageCount = (kind: TemplateKind) => manifest.entries.filter((e) => e.kind === kind).length

  return (
    <PageLayout
      title="テンプレ素材の管理"
      description="背景と立ち絵のテンプレを足す・置き換える・一覧から外す。ファイル名がそのままキーになります。"
      backHref="#/settings"
      backLabel="設定へ戻る"
      wide
    >
      {/* 投入 */}
      <section
        aria-label="画像の投入"
        className={cn(
          'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-outline-variant/40',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFiles([...e.dataTransfer.files])
        }}
      >
        <ImagePlus className="mx-auto size-6 text-on-surface-variant" aria-hidden />
        <p className="mt-2 text-on-surface text-sm">
          画像をここにまとめてドロップ（背景は <code>場所-時間帯.png</code>、立ち絵は{' '}
          <code>silhouette-人物像.png</code>）
        </p>
        <p className="mt-1 text-on-surface-variant text-xs">
          同じ名前を送ると置き換えになります。表示名と分類は、新しい名前にだけ既定値が付きます。
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 text-primary"
          disabled={Boolean(upload)}
          onClick={() => fileInputRef.current?.click()}
        >
          ファイルを選ぶ…
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="テンプレ画像を選ぶ"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void handleFiles(files)
          }}
        />
        {upload ? (
          <p className="mt-3 text-on-surface-variant text-xs" aria-live="polite">
            送っています… {upload.done}/{upload.total}{' '}
            {upload.current ? `（${upload.current}）` : ''}
          </p>
        ) : null}
        {log.length > 0 ? (
          <ul className="mt-3 space-y-0.5 text-left text-destructive text-xs">
            {log.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 一覧 */}
      <section className="mt-8" aria-label="テンプレ一覧">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-low p-1">
            {(['bg', 'sprite'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  tab === k
                    ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface',
                )}
                aria-pressed={tab === k}
                onClick={() => setTab(k)}
              >
                {k === 'bg' ? '背景' : '立ち絵'}（画像 {imageCount(k)}）
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {notice ? (
              <span className="text-on-surface-variant text-xs" aria-live="polite">
                {notice}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="gap-2"
            >
              <Save className="size-4" aria-hidden />
              変更を保存
            </Button>
          </div>
        </div>

        {groups.map(({ category, count }) => (
          <div key={category} className="mt-6">
            <div className="mb-2 flex items-center gap-3">
              <code className="text-on-surface-variant text-xs">{category}</code>
              <Input
                aria-label={`分類「${category}」の表示名`}
                className="h-8 w-40 text-sm"
                value={categoryDrafts[tab][category] ?? categoryLabelOf(manifest, tab, category)}
                onChange={(e) =>
                  setCategoryDrafts((prev) => ({
                    ...prev,
                    [tab]: { ...prev[tab], [category]: e.target.value },
                  }))
                }
              />
              <span className="text-on-surface-variant text-xs">{count} 枚</span>
            </div>
            <ul className="space-y-2">
              {rows
                .filter((r) => r.category === category)
                .map((row) => {
                  const draft = draftOf(tab, row.slug)
                  const entry = row.entry
                  const hidden = draft.hidden ?? row.hidden
                  const rowTime = 'time' in row ? row.time : undefined
                  const time = draft.time === undefined ? rowTime : draft.time
                  return (
                    <li
                      key={row.key}
                      className={cn(
                        'flex items-center gap-4 rounded-md border border-outline-variant/30 p-2',
                        hidden && 'opacity-60',
                      )}
                    >
                      <img
                        src={
                          tab === 'bg'
                            ? templateBgSrc(row as CatalogBackground, 'thumb')
                            : templateSpriteSrc(row as CatalogSprite, 'thumb')
                        }
                        alt=""
                        className={cn(
                          'shrink-0 rounded bg-surface-container object-contain',
                          tab === 'bg' ? 'aspect-video w-28' : 'h-16 w-12',
                        )}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <code className="text-on-surface text-xs">{row.slug}</code>
                          {entry ? (
                            <span className="text-on-surface-variant text-[11px]">
                              {kb(entry.bytes)}
                            </span>
                          ) : (
                            <span className="rounded bg-surface-container px-1.5 py-0.5 text-[11px] text-on-surface-variant">
                              画像なし（組み込みの SVG）
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            aria-label={`${row.slug} の表示名`}
                            className="h-8 w-48 text-sm"
                            disabled={!entry}
                            value={draft.label ?? row.label}
                            onChange={(e) => setDraft(tab, row.slug, { label: e.target.value })}
                          />
                          <Input
                            aria-label={`${row.slug} の分類`}
                            className="h-8 w-28 font-mono text-sm"
                            disabled={!entry}
                            value={draft.category ?? row.category}
                            onChange={(e) =>
                              setDraft(tab, row.slug, {
                                category: e.target.value.trim().toLowerCase(),
                              })
                            }
                          />
                          {tab === 'bg' ? (
                            <select
                              aria-label={`${row.slug} の時間帯`}
                              className="h-8 rounded-md border border-outline-variant bg-surface-container-lowest px-2 text-sm"
                              disabled={!entry}
                              value={time ?? ''}
                              onChange={(e) =>
                                setDraft(tab, row.slug, {
                                  time: e.target.value ? (e.target.value as GameTime) : null,
                                })
                              }
                            >
                              <option value="">時間帯なし</option>
                              {TEMPLATE_TIMES.map((t) => (
                                <option key={t} value={t}>
                                  {timeLabelOf(t)}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-on-surface-variant text-xs">
                        <Switch
                          aria-label={`${row.slug} を一覧に出す`}
                          disabled={!entry}
                          checked={!hidden}
                          onCheckedChange={(on) => setDraft(tab, row.slug, { hidden: !on })}
                        />
                        一覧に出す
                      </div>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </section>

      {/* TSV */}
      <section className="mt-10" aria-label="表示名の一括取り込み">
        <h2 className="font-semibold font-serif text-[17px] text-on-surface">
          表示名を TSV から入れる
        </h2>
        <p className="mt-1 text-on-surface-variant text-xs">
          改名 AI が返した <code>bg.tsv</code> / <code>sprite.tsv</code> をそのまま貼ります（1
          列目がファイル名、3 列目が表示名、4 列目が分類の語）。入れたあとに「変更を保存」。
        </p>
        <Textarea
          aria-label="TSV"
          className="mt-2 h-32 font-mono text-xs"
          value={tsv}
          onChange={(e) => setTsv(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 text-primary"
          disabled={!tsv.trim()}
          onClick={importTsv}
        >
          表示名を取り込む
        </Button>
      </section>
    </PageLayout>
  )
}
