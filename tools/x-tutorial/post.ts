/**
 * 録った動画を X に投稿する。
 *
 *   node tools/x-tutorial/post.ts <動画.mp4> <投稿文.txt>          … 試運転（何も送らず検査だけ）
 *   node tools/x-tutorial/post.ts <動画.mp4> <投稿文.txt> --live   … 本当に投稿する
 *   node tools/x-tutorial/post.ts --whoami                        … 認証の確認（投稿先の垢名）
 *
 * 認証は環境変数 X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET
 * （OAuth 1.0a・投稿する垢のアクセストークン）。値は表示しない。
 * 投稿文に URL があると 1 件 $0.20（無しは $0.015）になり、表示回数も落ちるので既定で止める
 * （どうしても入れるときは --allow-url）。最後の行に結果を JSON で出す。
 */
import { readFileSync, statSync } from 'node:fs'
import { hasUrl, weightedLength, type XCredentials, XClient } from './lib/x-client.ts'

const MAX_WEIGHT = 280

function credentials(): XCredentials {
  const names = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'] as const
  const missing = names.filter((n) => !process.env[n])
  if (missing.length) {
    throw new Error(
      `環境変数 ${missing.join(', ')} が無い。クラウド環境の設定（Environment variables）に入れる`,
    )
  }
  return {
    apiKey: process.env.X_API_KEY as string,
    apiSecret: process.env.X_API_SECRET as string,
    accessToken: process.env.X_ACCESS_TOKEN as string,
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET as string,
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--whoami') {
    const me = await new XClient(credentials()).me()
    console.log(JSON.stringify({ ok: true, username: me.username, id: me.id }))
    return
  }

  const [videoPath, textPath] = args.filter((a) => !a.startsWith('--'))
  const live = args.includes('--live')
  const allowUrl = args.includes('--allow-url')
  if (!videoPath || !textPath) throw new Error('使い方: post.ts <動画.mp4> <投稿文.txt> [--live]')

  const text = readFileSync(textPath, 'utf8').trim()
  const weight = weightedLength(text)
  const problems: string[] = []
  if (!text) problems.push('投稿文が空')
  if (weight > MAX_WEIGHT) problems.push(`投稿文が長い（${weight} / ${MAX_WEIGHT}。全角は 2 と数える）`)
  if (hasUrl(text) && !allowUrl) problems.push('投稿文に URL がある（1 件 $0.20 になる。入れるなら --allow-url）')
  const bytes = statSync(videoPath).size
  if (problems.length) {
    console.log(JSON.stringify({ ok: false, live, weight, bytes, problems }))
    process.exitCode = 1
    return
  }

  if (!live) {
    console.log(JSON.stringify({ ok: true, live: false, weight, bytes, text }))
    return
  }

  const client = new XClient(credentials())
  const { mediaId, via } = await client.uploadVideo(readFileSync(videoPath))
  const post = await client.createPost(text, [mediaId])
  console.log(
    JSON.stringify({
      ok: true,
      live: true,
      postId: post.id,
      url: `https://x.com/i/web/status/${post.id}`,
      uploadVia: via,
      weight,
    }),
  )
}

await main()
