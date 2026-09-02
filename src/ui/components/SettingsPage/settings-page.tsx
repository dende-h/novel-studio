import { Monitor, Moon, Sun } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'
import { type ReadingSize, type Theme, usePreferences } from '@/ui/hooks/use-preferences'
import { useIsStaff } from '@/ui/hooks/use-staff'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ComponentType<{ className?: string }>
}

/** ライブラリの表示切替と同じ意匠のセグメント切替。 */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  ariaLabel: string
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-low p-1">
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            aria-label={`${ariaLabel}: ${label}`}
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-3 font-medium font-sans text-[13px] transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            )}
          >
            {Icon ? <Icon className="size-[15px]" /> : null}
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** 設定の 1 項目（左に見出し＋説明、右にコントロール。狭い幅では縦積み）。 */
function SettingRow({
  label,
  description,
  control,
}: {
  label: string
  description: string
  control: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-4">
      <div className="min-w-0">
        <div className="font-medium text-[14px] text-on-surface">{label}</div>
        <div className="mt-0.5 text-[12px] text-on-surface-variant">{description}</div>
      </div>
      {control}
    </div>
  )
}

const THEME_OPTIONS: SegmentedOption<Theme>[] = [
  { value: 'light', label: 'ライト', icon: Sun },
  { value: 'dark', label: 'ダーク', icon: Moon },
  { value: 'system', label: 'システム', icon: Monitor },
]

const SIZE_OPTIONS: SegmentedOption<ReadingSize>[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
]

/** 設定ページ（外観テーマ・本文の文字サイズ）。 */
export function SettingsPage() {
  const { theme, readingSize, setTheme, setReadingSize } = usePreferences()
  // 運営だけに管理ページの入口を出す（それ以外は何も出ない）
  const staff = useIsStaff(true)

  return (
    <PageLayout
      title="設定"
      description="表示まわりの好みを整えます。変更はこの端末にだけ保存されます。"
    >
      <section className="space-y-6">
        {/* 外観 */}
        <div>
          <h2 className="mb-2.5 font-semibold font-serif text-[17px] text-on-surface">外観</h2>
          <SettingRow
            label="テーマ"
            description="「システム」は端末の設定（ライト／ダーク）に自動で合わせます。"
            control={
              <Segmented
                ariaLabel="テーマ"
                value={theme}
                onChange={setTheme}
                options={THEME_OPTIONS}
              />
            }
          />
        </div>

        {/* 本文の表示 */}
        <div>
          <h2 className="mb-2.5 font-semibold font-serif text-[17px] text-on-surface">
            本文の表示
          </h2>
          <SettingRow
            label="文字サイズ"
            description="エディタとプレビューの本文サイズを変えます。"
            control={
              <Segmented
                ariaLabel="文字サイズ"
                value={readingSize}
                onChange={setReadingSize}
                options={SIZE_OPTIONS}
              />
            }
          />
          {/* 変更が本文にどう効くかをその場で確認できるサンプル（--reading-font-size に追従）。 */}
          <div className="mt-3 rounded-lg border border-outline-variant/30 bg-surface-variant px-6 py-5">
            <div className="mb-1.5 text-[11px] text-on-surface-variant/70 tracking-widest">
              プレビュー
            </div>
            <p className="preview font-serif text-on-surface leading-[2.1]">
              よく晴れた朝、彼女は古い万年筆を手に取り、まだ誰も知らない物語の一行目を書き始めた。
            </p>
          </div>
        </div>

        {staff ? (
          <div>
            <h2 className="mb-2.5 font-semibold font-serif text-[17px] text-on-surface">運営</h2>
            <a
              href="#/admin/templates"
              className="text-[14px] text-primary underline-offset-2 hover:underline"
            >
              テンプレ素材の管理
            </a>
          </div>
        ) : null}
      </section>
    </PageLayout>
  )
}
