#!/usr/bin/env node
// 推敲画面の品詞ルールのテスト用に、例文を実際の lindera（IPADIC）で解析した結果を JSON に書き出す（COT-40）。
// 手で回す（CI では回さない）。辞書は scripts/fetch-dict.mjs が置いた public/dict/ の zip を使う。
//   node scripts/gen-morph-fixtures.mjs
// 出力: src/core/proofread/morph/__fixtures__/samples.json（{ text, raw: [表層形, ...details][] }[]）
// 書き出したあと Biome で整形する（CI の lint は src/ の JSON の形も見る）:
//   pnpm exec biome format --write src/core/proofread/morph/__fixtures__/samples.json
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const pkgDir = dirname(require.resolve('lindera-wasm'))
const lindera = await import(pathToFileURL(join(pkgDir, 'lindera_wasm.js')).href)
lindera.initSync({ module: readFileSync(join(pkgDir, 'lindera_wasm_bg.wasm')) })

const zip = readFileSync(join(root, 'public', 'dict', 'lindera-ipadic-6.2.0.zip'))
function entries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    out.set(name.split('/').pop(), new Uint8Array(method === 0 ? data : inflateRawSync(data)))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
const f = entries(zip)
const dict = lindera.loadDictionaryFromBytes(
  f.get('metadata.json'), f.get('dict.trie'), f.get('dict.valsidx'), f.get('dict.vals'),
  f.get('dict.wordsidx'), f.get('dict.words'), f.get('matrix.mtx'), f.get('char_def.bin'), f.get('unk.bin'),
)
const builder = new lindera.TokenizerBuilder()
builder.setDictionaryInstance(dict)
builder.setMode('normal')
builder.setKeepWhitespace(true)
const tokenizer = builder.build()

const SAMPLES = [
  // 同じ助詞
  '材料不足で代替素材で製品を作った。',
  '私は彼は好きだ。',
  '私は、彼は好きだ。',
  '彼は家に帰り、私は駅に向かった。',
  '私も彼も笑った。',
  '山や川や海を見た。',
  '非常口の緑の光がが揺れて',
  '私は昇降口で靴箱の前で立ち止まった。',
  '何かが動いた気がした。',
  '彼が来たのが嬉しかった。',
  // ら抜き
  '食べれる。起きれる。寝れない。来れない。見れる。',
  '食べられる。来られる。入れる。帰れる。読める。',
  '「ここからでも見れるよ」と彼は言った。',
  '「ここから見れるよ」と言ったが、私には見れなかった。',
  // 表記ゆれの自動発見
  '子供と子どもが遊ぶ。',
  '分かる。わかる。分かった。わかった。',
  '行う。行なう。',
  '急いで行った事がある。そのことを忘れて行く。忘れていく。',
  '暑い日と熱い湯。人に会う。話が合う。',
  '仕事の事を考えた。',
  '鳥が飛んできた。彼にもできた。出来なかった。',
  // よく使う言葉
  'ふと、思わず、小さく笑った。ふと見ると、ゆっくり歩いていた。',
  // 固有名詞
  '宮森は言った。',
]

const out = SAMPLES.map((text) => ({
  text,
  raw: tokenizer.tokenize(text).map((t) => [t.surface, ...t.details]),
}))
const dest = join(root, 'src', 'core', 'proofread', 'morph', '__fixtures__', 'samples.json')
writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`)
console.log(`[gen-morph-fixtures] ${out.length} 文を ${dest} に書きました`)
