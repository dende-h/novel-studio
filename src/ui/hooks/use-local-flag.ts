import { useCallback, useState } from 'react'

/**
 * localStorage に置く「一度立てたら永続」の一方向フラグ（初回説明を出したか等）。
 * プライベートモードで localStorage が使えなくても例外を握りつぶし、フラグ無し＝未設定として扱う。
 * 端末ローカルの UI 状態なので同期・課金とは無関係（プライバシーポリシー §2「端末内設定」の範疇）。
 */
export function useLocalFlag(key: string): readonly [boolean, () => void] {
  const [flagged, setFlagged] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const mark = useCallback(() => {
    try {
      localStorage.setItem(key, '1')
    } catch {
      // プライベートモード等。フラグが立たず再表示されるが害はない。
    }
    setFlagged(true)
  }, [key])
  return [flagged, mark] as const
}
