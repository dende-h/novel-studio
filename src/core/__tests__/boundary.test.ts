import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * core/ui 境界をテストで強制する（依存=lintプラグインに頼らず所有する）。
 * core は React / ui を import してはならない。
 */

const CORE_DIR = join(process.cwd(), 'src', 'core')
const FORBIDDEN: RegExp[] = [
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom/,
  /from\s+['"][^'"]*\/ui\//,
]

function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectSources(p))
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p)
  }
  return out
}

describe('core boundary', () => {
  it('core は React / ui を import しない', () => {
    for (const file of collectSources(CORE_DIR)) {
      const src = readFileSync(file, 'utf8')
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${file} が core 境界に違反 (${re})`).toBe(false)
      }
    }
  })
})
