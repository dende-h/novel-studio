import type { KeyValueStore } from './types'

/**
 * インメモリ実装。テスト用および IndexedDB 不在環境のフォールバック。
 * set/get で structuredClone し、保存値を外部参照から隔離する。
 */
export class MemoryStore implements KeyValueStore {
  private map = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key)
    return v === undefined ? undefined : (structuredClone(v) as T)
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, structuredClone(value))
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.map.keys()]
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all
  }
}
