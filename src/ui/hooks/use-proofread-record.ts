import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProofreadRecord } from '@/core/proofread/decisions'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

/** 判断の読み書きに使う repo の口（ProofreadRepository を withSyncTouch で包んだもの）。 */
export interface ProofreadRecordRepo {
  get(workId: string, episodeId: string): Promise<ProofreadRecord | undefined>
  save(record: ProofreadRecord): Promise<void>
  /** 作品の全話の判断（COT-62・決まりの提案の回数を数える）。無ければ提案を出さない。 */
  listByWork?(workId: string): Promise<ProofreadRecord[]>
}

/**
 * 保存した判断を、同じ話を見ている別の画面へ知らせる口。執筆画面（「直す箇所」）は画面を切り替えても
 * 残り続けるので、推敲画面で決めた「直す」を読み直さずに受け取る。
 */
const savedListeners = new Set<(record: ProofreadRecord) => void>()

/**
 * 1 話ぶんの推敲の判断（COT-40）。話が変わったら読み直し、同期の取り込み（sync-applied）でも読み直す。
 * 保存は画面の値を先に替えてから repo へ書く（判断のボタンをすぐ反映させる）。同じ話を持つ
 * 別の画面（このフックの別の呼び出し）にも、保存した値を渡す。
 */
export function useProofreadRecord(
  repo: ProofreadRecordRepo | undefined,
  workId: string | undefined,
  episodeId: string | undefined,
): {
  record: ProofreadRecord | undefined
  loaded: boolean
  save: (next: ProofreadRecord) => Promise<void>
} {
  const [state, setState] = useState<{ key: string; record: ProofreadRecord | undefined } | null>(
    null,
  )
  const key = workId && episodeId ? `${workId}:${episodeId}` : ''
  const keyRef = useRef(key)
  keyRef.current = key

  const load = useCallback(() => {
    if (!repo || !workId || !episodeId) return
    const k = `${workId}:${episodeId}`
    void repo.get(workId, episodeId).then(
      (record) => {
        if (keyRef.current === k) setState({ key: k, record })
      },
      () => {
        if (keyRef.current === k) setState({ key: k, record: undefined })
      },
    )
  }, [repo, workId, episodeId])

  useEffect(() => {
    load()
    return subscribeSyncApplied(load)
  }, [load])

  useEffect(() => {
    const onSaved = (record: ProofreadRecord) => {
      const k = `${record.workId}:${record.episodeId}`
      if (keyRef.current === k) setState({ key: k, record })
    }
    savedListeners.add(onSaved)
    return () => {
      savedListeners.delete(onSaved)
    }
  }, [])

  const save = useCallback(
    async (next: ProofreadRecord) => {
      for (const listener of savedListeners) listener(next)
      await repo?.save(next)
    },
    [repo],
  )

  const current = state && state.key === key ? state : null
  return { record: current?.record, loaded: current !== null, save }
}
