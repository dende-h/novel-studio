import { z } from 'zod'

// コトノハ-grove- の apps/novel/src/domain/work-binding.ts と揃える。
export const BINDING_LABELS = {
  moss: '深森クロス装',
  washi: '生成り越前和紙',
  indigo: '鉄紺麻布装',
  burgundy: '茜葡萄酒クロス',
  celadon: '青磁霞装',
  umber: '琥珀胡桃装',
  ivorygold: '鳥の子金罫装',
  slate: '薄暮鼠クロス',
} as const

export const MOTIF_LABELS = {
  lighthouse: '岬の灯台',
  clock: '懐中時計',
  botanical: '木立の枝葉',
  stars: '天球と星図',
  letter: '封蝋書簡',
  hourglass: '真鍮砂時計',
  train: '夜汽車と鉄橋',
  musicbox: '歯車とオルゴール',
} as const

export const CATCHCOPY_MAX = 120
export const OBI_TEXT_MAX = 25

const moodAxis = z.number().int().min(0).max(100)

function presentationText(max: number) {
  return z
    .string()
    .trim()
    .refine((value) => [...value].length <= max)
    .transform((value) => value || null)
    .nullable()
    .optional()
    .catch(undefined)
}

// 欠落は据え置き、null は公開先で解除。読めない項目だけを落とす。
export const WorkPresentationSchema = z
  .object({
    mood: z.object({ tone: moodAxis, pace: moodAxis }).nullable().optional().catch(undefined),
    catchcopy: presentationText(CATCHCOPY_MAX),
    binding: z
      .enum(Object.keys(BINDING_LABELS) as (keyof typeof BINDING_LABELS)[])
      .nullable()
      .optional()
      .catch(undefined),
    motif: z
      .enum(Object.keys(MOTIF_LABELS) as (keyof typeof MOTIF_LABELS)[])
      .nullable()
      .optional()
      .catch(undefined),
    obiText: presentationText(OBI_TEXT_MAX),
    showObi: z.boolean().optional().catch(undefined),
  })
  .catch({})
  .transform((value) => {
    const entries = Object.entries(value).filter(([, field]) => field !== undefined)
    return entries.length > 0 ? (Object.fromEntries(entries) as typeof value) : undefined
  })
  .optional()

export type WorkPresentation = NonNullable<z.infer<typeof WorkPresentationSchema>>
