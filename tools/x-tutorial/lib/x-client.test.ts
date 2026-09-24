// node --test tools/x-tutorial/lib/x-client.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasUrl, oauthHeader, pct, weightedLength } from './x-client.ts'

test('OAuth 1.0a の署名が X 公式ドキュメント「Creating a signature」の例と一致する', () => {
  const header = oauthHeader(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    {
      apiKey: 'xvz1evFS4wEEPTGEFPHBog',
      apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    },
    { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' },
  )
  assert.match(header, new RegExp(`oauth_signature="${pct('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')}"`))
})

test('文字数は全角 2・半角 1・URL 23 で数える', () => {
  assert.equal(weightedLength('あいう'), 6)
  assert.equal(weightedLength('abc'), 3)
  assert.equal(weightedLength('見て https://example.com/very/long/path'), 4 + 1 + 23)
})

test('投稿文の URL を見つける（URL 入りは 1 件 $0.20 になる）', () => {
  assert.equal(hasUrl('ルビと傍点 #小説執筆'), false)
  assert.equal(hasUrl('詳しくは https://cotonoha-leaf.org'), true)
  assert.equal(hasUrl('cotonoha-leaf.org で'), true)
})
