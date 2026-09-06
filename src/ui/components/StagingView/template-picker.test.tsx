import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PRESET_SES } from '@/core/game/sePresets'
import {
  EMPTY_TEMPLATE_MANIFEST,
  mergeBackgroundCatalog,
  mergeBgmCatalog,
  mergeSeCatalog,
  type TemplateEntry,
} from '@/core/game/templates'
import { TemplatePicker } from './template-picker'

const sePlayer = vi.hoisted(() => ({ playCatalogSe: vi.fn(), playPresetSe: vi.fn() }))
vi.mock('@/ui/_utils/sePlayer', () => sePlayer)
const bgmPlayer = vi.hoisted(() => ({
  toggleCatalogBgm: vi.fn(),
  isCatalogBgmPreviewing: () => false,
  subscribeBgmPreview: () => () => {},
  bgmPreviewingUrl: () => null,
}))
vi.mock('@/ui/_utils/bgmPlayer', () => bgmPlayer)

const entry = (slug: string, over: Partial<TemplateEntry> = {}): TemplateEntry => ({
  kind: 'bg',
  slug,
  label: slug,
  category: slug.split('-')[0] ?? '',
  tone: ['#111111', '#222222', '#333333'],
  mime: 'image/webp',
  bytes: 1,
  hash: 'h',
  updatedAt: 1,
  ...over,
})

describe('TemplatePicker', () => {
  it('分類のタブで絞り、選ぶとキーが返って閉じる。非表示は出ない', () => {
    const manifest = {
      ...EMPTY_TEMPLATE_MANIFEST,
      categories: { bg: { school: '学校' }, sprite: {}, se: {}, bgm: {} },
      entries: [
        entry('school-hall-day', { label: '学校の廊下（昼）', time: 'day' }),
        entry('school-gate-night', { label: '校門（夜）', time: 'night' }),
        entry('room-day', { hidden: true }),
      ],
    }
    const onPick = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <TemplatePicker
        open
        onOpenChange={onOpenChange}
        kind="bg"
        items={mergeBackgroundCatalog(manifest)}
        manifest={manifest}
        selectedKey="preset:bg/town-night"
        onPick={onPick}
      />,
    )
    // すべて：組み込み 17（room-day は非表示）＋目録 2（選択中の town-night を除く）
    expect(screen.getAllByRole('button', { pressed: false }).length).toBe(18)
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('街（夜）')
    expect(screen.queryByText('室内（昼）')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /学校/ }))
    expect(screen.getByRole('tab', { name: /学校/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '校門（夜）' }))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'preset:bg/school-gate-night' }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('効果音は一覧（▶ 試聴つき）。合成の各種と目録の音が並び、選ぶとキーが返る', () => {
    const manifest = {
      ...EMPTY_TEMPLATE_MANIFEST,
      entries: [
        entry('weather-rain-heavy', {
          kind: 'se',
          label: '強い雨',
          category: 'weather',
          mime: 'audio/mpeg',
          durationMs: 4200,
        }),
      ],
    }
    const onPick = vi.fn()
    render(
      <TemplatePicker
        open
        onOpenChange={() => {}}
        kind="se"
        items={mergeSeCatalog(manifest)}
        manifest={manifest}
        onPick={onPick}
      />,
    )
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(PRESET_SES.length + 1)
    fireEvent.click(screen.getByRole('button', { name: '強い雨を試聴' }))
    expect(sePlayer.playCatalogSe).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'preset:se/weather-rain-heavy' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /強い雨 4\.2 秒/ }))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'preset:se/weather-rain-heavy' }),
    )
  })

  it('BGM は一覧（▶ 試聴つき）。曲調で絞れ、長さは 分:秒 で出る', () => {
    const manifest = {
      ...EMPTY_TEMPLATE_MANIFEST,
      categories: { bg: {}, sprite: {}, se: {}, bgm: {} },
      entries: [
        entry('bgm-calm-morning', {
          kind: 'bgm',
          label: '朝',
          category: 'calm',
          mime: 'audio/mpeg',
          durationMs: 92_000,
        }),
        entry('bgm-tense-chase', {
          kind: 'bgm',
          label: '追走',
          category: 'tense',
          mime: 'audio/mpeg',
        }),
      ],
    }
    const onPick = vi.fn()
    render(
      <TemplatePicker
        open
        onOpenChange={() => {}}
        kind="bgm"
        items={mergeBgmCatalog(manifest)}
        manifest={manifest}
        onPick={onPick}
      />,
    )
    expect(screen.getByRole('tab', { name: /日常/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '朝を試聴' }))
    expect(bgmPlayer.toggleCatalogBgm).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'preset:bgm/bgm-calm-morning' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /朝 日常 1:32/ }))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'preset:bgm/bgm-calm-morning' }),
    )
  })
})
