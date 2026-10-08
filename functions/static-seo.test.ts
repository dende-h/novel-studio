/**
 * 検索・AI 検索向けの静的な案内（COT-22〜24）を機械で固定する。
 *
 * - JSON-LD の FAQPage と、画面に出ている FAQ の文言が一字一句同じであること。
 *   食い違いは Google のガイドライン違反で、しかも人の目では気づきにくい。
 * - AI 連携ページ（/lp/ai/）と /llms-full.txt が、MCP サーバーの実際のツールを過不足なく
 *   載せていること。ツールを足し引きしたら、AI に見せている案内も同時に直す。
 * - robots.txt が利用者のデータの窓口（/api/）を閉じたまま、紹介ページを開いていること。
 * - 公開している静的ページが、すべて sitemap に載っていること。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MCP_TOOLS } from './api/_lib/mcp-server'

const ORIGIN = 'https://cotonoha-leaf.org'
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
/**
 * HTML を DOM として読む。外部の読み込み（フォントの link・hit.js など）と JSON-LD 以外の script は
 * 先に外す——happy-dom が取りに行ったり実行したりしないように。
 */
const parse = (path: string) =>
  new DOMParser().parseFromString(
    read(path)
      .replace(/<link\b[^>]*>/g, '')
      .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/g, ''),
    'text/html',
  )

type LdNode = Record<string, unknown>

/** ページ内の JSON-LD をすべて読み、@graph を平らにしたノードの一覧を返す。 */
function ldNodesOf(doc: Document): LdNode[] {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => {
    const json = JSON.parse(script.textContent ?? '') as LdNode
    expect(json['@context']).toBe('https://schema.org')
    return Array.isArray(json['@graph']) ? (json['@graph'] as LdNode[]) : [json]
  })
}

const nodeOfType = (nodes: LdNode[], type: string) => nodes.find((node) => node['@type'] === type)

interface Qa {
  q: string
  a: string
}

/** JSON-LD の FAQPage から質問と答えを取り出す。 */
function ldFaqOf(nodes: LdNode[]): Qa[] {
  const faq = nodeOfType(nodes, 'FAQPage')
  expect(faq, 'FAQPage が無い').toBeDefined()
  return (faq?.mainEntity as LdNode[]).map((item) => ({
    q: String(item.name),
    a: String((item.acceptedAnswer as LdNode).text),
  }))
}

/** 画面に出ている FAQ（details の summary と本文）を取り出す。開閉の記号は除く。 */
function visibleFaqOf(doc: Document): Qa[] {
  return [...doc.querySelectorAll('#faq details')].map((details) => {
    const summary = details.querySelector('summary')?.cloneNode(true) as HTMLElement
    for (const mark of summary.querySelectorAll('[data-plus], .plus')) mark.remove()
    return {
      q: (summary.textContent ?? '').trim(),
      a: (details.querySelector('p')?.textContent ?? '').trim(),
    }
  })
}

describe('JSON-LD', () => {
  it('どのページの JSON-LD も JSON として読める', () => {
    for (const path of ['index.html', 'public/lp/index.html', 'public/lp/ai/index.html']) {
      expect(ldNodesOf(parse(path)).length, path).toBeGreaterThan(0)
    }
  })

  it('LP の FAQPage は、画面の「よくある質問」と一字一句同じ', () => {
    const doc = parse('public/lp/index.html')
    const visible = visibleFaqOf(doc)
    expect(visible.length).toBeGreaterThan(0)
    expect(ldFaqOf(ldNodesOf(doc))).toEqual(visible)
  })

  it('AI 連携ページの FAQPage は、画面の「よくある質問」と一字一句同じ', () => {
    const doc = parse('public/lp/ai/index.html')
    const visible = visibleFaqOf(doc)
    expect(visible.length).toBeGreaterThan(0)
    expect(ldFaqOf(ldNodesOf(doc))).toEqual(visible)
  })

  it('LP のアプリ情報は、meta description と料金の表示に揃っている', () => {
    const doc = parse('public/lp/index.html')
    const app = nodeOfType(ldNodesOf(doc), 'WebApplication')
    expect(app).toBeDefined()
    expect(app?.description).toBe(
      doc.querySelector('meta[name="description"]')?.getAttribute('content'),
    )
    const prices = (app?.offers as LdNode[]).map((offer) => offer.price)
    expect(prices).toEqual(['0', '500', '4800'])
    const text = doc.body.textContent ?? ''
    expect(text).toContain('¥500')
    expect(text).toContain('¥4,800')
    // AI に勧めてもらう要点：MCP で Claude・ChatGPT とつながること
    expect((app?.featureList as string[]).some((feature) => feature.includes('MCP'))).toBe(true)
  })

  it('ルート（SPA）にもアプリ情報がある（JS を実行しないクローラーには唯一の説明）', () => {
    const nodes = ldNodesOf(parse('index.html'))
    expect(nodeOfType(nodes, 'WebSite')).toBeDefined()
    expect(nodeOfType(nodes, 'WebApplication')?.['@id']).toBe(`${ORIGIN}/#app`)
  })
})

describe('MCP ツールの一覧', () => {
  const names = MCP_TOOLS.map((tool) => tool.name).sort()

  it('AI 連携ページは、MCP サーバーのツールを過不足なく載せている', () => {
    const doc = parse('public/lp/ai/index.html')
    const listed = [...doc.querySelectorAll('#tools .tools code')].map((code) => code.textContent)
    expect(listed.sort()).toEqual(names)
  })

  it('llms-full.txt も、MCP サーバーのツールを過不足なく載せている', () => {
    const listed = [...read('public/llms-full.txt').matchAll(/^- `([a-z_]+)`：/gm)].map(
      (match) => match[1],
    )
    expect(listed.sort()).toEqual(names)
  })
})

describe('robots.txt', () => {
  const lines = read('public/robots.txt')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)

  it('どの User-agent のグループも /api/ を閉じている（名指しのグループを足しても開けない）', () => {
    const groups: string[][] = []
    for (const line of lines) {
      if (/^user-agent:/i.test(line)) {
        const last = groups.at(-1)
        // User-agent が続く行は同じグループ
        if (last?.every((l) => /^user-agent:/i.test(l))) last.push(line)
        else groups.push([line])
      } else if (groups.length > 0 && !/^sitemap:/i.test(line)) {
        groups.at(-1)?.push(line)
      }
    }
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      expect(group, group.join(' / ')).toContain('Disallow: /api/')
    }
  })

  it('leaf はサイト全体を閉じない（紹介ページを検索・AI に開く方針）', () => {
    expect(lines).not.toContain('Disallow: /')
  })

  it('sitemap を案内している', () => {
    expect(lines).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  })
})

describe('sitemap.xml', () => {
  const sitemap = read('public/sitemap.xml')
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

  /** public/ の静的 HTML を、Pages が配る URL（拡張子なし・index は末尾スラッシュ）に直す。 */
  function publicPages(dir = 'public'): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return publicPages(path)
      if (!name.endsWith('.html')) return []
      const route = `/${relative('public', path)}`
        .replace(/index\.html$/, '')
        .replace(/\.html$/, '')
      return [`${ORIGIN}${route}`]
    })
  }

  it('公開している静的ページは、すべて載っている', () => {
    for (const page of publicPages()) expect(locs, page).toContain(page)
  })

  it('アプリ（/）と AI 連携ページが載っている', () => {
    expect(locs).toContain(`${ORIGIN}/`)
    expect(locs).toContain(`${ORIGIN}/lp/ai/`)
  })
})

describe('llms.txt', () => {
  it('llmstxt.org の形（H1 の名前・引用の要約）で始まる', () => {
    const lines = read('public/llms.txt').split('\n')
    expect(lines[0]).toBe('# コトノハ-leaf-')
    expect(lines.find((line) => line.startsWith('> '))).toBeDefined()
  })

  it('リンクはすべて絶対 URL（相対だと AI が辿れない）', () => {
    for (const path of ['public/llms.txt', 'public/llms-full.txt']) {
      const links = [...read(path).matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])
      for (const link of links) expect(link, `${path}: ${link}`).toMatch(/^https:\/\//)
    }
  })
})
