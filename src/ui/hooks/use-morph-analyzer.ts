import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { glossaryTerms, glossaryUserDictCsv } from '@/core/proofread/user-dict'
import type { GlossaryEntry } from '@/core/schema'
import {
  type AnalyzerState,
  createMorphAnalyzerClient,
  type MorphAnalyzerClient,
} from '@/ui/proofread/analyzer-client'

/**
 * 推敲画面のくわしい確認（形態素解析）を使う（COT-40）。推敲画面のマウントで Worker を起こし、
 * アンマウントで止める。用語集の名前・別名が変わったら作り直す（ユーザー辞書に入れるため）。
 * テストでは createClient に偽物を渡す。
 */
export function useMorphAnalyzer(
  glossary: ReadonlyArray<GlossaryEntry>,
  createClient: () => MorphAnalyzerClient = createMorphAnalyzerClient,
): {
  state: AnalyzerState
  client: MorphAnalyzerClient
  excluded: ReadonlySet<string>
  retry: () => void
} {
  const [client] = useState(createClient)
  const terms = useMemo(() => glossaryTerms(glossary), [glossary])
  const csv = useMemo(() => glossaryUserDictCsv(glossary), [glossary])
  const termsKey = terms.join('\n')
  const excluded = useMemo(() => new Set(termsKey ? termsKey.split('\n') : []), [termsKey])
  // csv は termsKey と読みから決まる。読みだけを直したときも作り直す
  useEffect(() => {
    client.start(csv, termsKey ? termsKey.split('\n') : [])
    return () => client.stop()
  }, [client, csv, termsKey])
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState)
  const retry = useCallback(
    () => client.start(csv, termsKey ? termsKey.split('\n') : []),
    [client, csv, termsKey],
  )
  return { state, client, excluded, retry }
}
