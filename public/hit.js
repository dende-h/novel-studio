/*
 * 訪問者カウントのビーコン（Cookie なし・1 ページ読み込みにつき 1 回）。
 *
 * 送るのはパスと参照元だけ。人の識別は行わず、サーバ側（/api/hit）が
 * 「その日限りの不可逆な符号」に変換して 1 行だけ残す。
 *
 * 運営者自身を数えないための逃がし口：
 *   https://cotonoha-leaf.org/?noanalytics=1  … その端末・そのブラウザを以後カウントしない
 *   https://cotonoha-leaf.org/?noanalytics=0  … 解除
 * 端末ごと・ブラウザごとに 1 回ずつ開くこと（localStorage はオリジン単位で分かれる）。
 * grove からこのファイルを読み込む場合も、grove のオリジンで同じ操作をする。
 */
;(function () {
  try {
    var KEY = 'ns-no-analytics'

    var flag = new URLSearchParams(location.search).get('noanalytics')
    if (flag === '1') localStorage.setItem(KEY, '1')
    else if (flag === '0') localStorage.removeItem(KEY)
    if (localStorage.getItem(KEY) === '1') return

    // 本番の 2 サイト以外（stg・プレビュー・localhost）は送らない。サーバ側も同じ許可リストで
    // 弾くが、そもそも飛ばさないほうが開発中のノイズが分かりやすい。
    var host = location.hostname
    var leaf = host === 'cotonoha-leaf.org' || host === 'www.cotonoha-leaf.org'
    var grove =
      host === 'grove.cotonoha-leaf.org' ||
      host === 'cotonoha-grove.org' ||
      host === 'www.cotonoha-grove.org'
    if (!leaf && !grove) return

    // leaf は同一オリジン。grove は別デプロイなので leaf の /api/hit へ送る
    //（sendBeacon の本文は text/plain 扱い＝プリフライトなしで越境できる）。
    var url = leaf ? '/api/hit' : 'https://cotonoha-leaf.org/api/hit'
    var body = JSON.stringify({ p: location.pathname, r: document.referrer })

    if (navigator.sendBeacon) navigator.sendBeacon(url, body)
    else fetch(url, { method: 'POST', body: body, mode: 'no-cors', keepalive: true })
  } catch (e) {
    // 計測はページの体験より下。何があっても本文の表示を止めない。
  }
})()
