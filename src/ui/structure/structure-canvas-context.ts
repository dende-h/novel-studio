import { createContext } from 'react'

/** 共通キャンバス（相関図）のノード/辺から削除を呼ぶためのコンテキスト。 */
export interface StructureCanvasActions {
  onDeleteNode: (id: string) => void
  onDeleteEdge: (id: string) => void
}

export const StructureCanvasContext = createContext<StructureCanvasActions | null>(null)
