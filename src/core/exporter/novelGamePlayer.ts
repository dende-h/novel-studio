import type { CreditLine } from '../game/presets'

/**
 * サウンドノベルのプレイヤー（zip の index.html）。設計は docs/requirement/07-novel-game.md §5。
 *
 * 自己完結を最優先にする——シナリオ JSON・CSS・JS はすべて index.html に埋め、
 * 外部参照はフォントと背景（assets/ 相対パス）だけ。fetch を使わないので、
 * サーバ無しで index.html をダブルクリックしても（file://）動く。
 *
 * 品質の優先順（D-GAME-QUALITY）: 文字組 ＞ 文字送りの間 ＞ オート/スキップ/ログ/セーブ
 * ＞ Ken Burns/クロスフェード。この4つをここで全部持つ。縦書きは G0 では持たない。
 */

/**
 * 立ち絵の舞台の1人ぶん。k=立ち絵キー、p=位置（1人なら c、2人なら l / r）、
 * a=いま話している（明るく表示。無い人物は減光）。
 */
export interface ScenarioStageEntry {
  k: string
  p: 'l' | 'c' | 'r'
  a?: 1
}

/** プレイヤーの1メッセージ。units は文字送りの1コマ（HTML 断片、または [HTML, 純文字] の組）。 */
export interface ScenarioPage {
  id: string
  kind: 'dialogue' | 'narration'
  speaker?: string
  /** 直前の空行数（間）。0 は省略 */
  beat?: number
  sceneBreak?: boolean
  /** G0 では背景切替（bg）と同時のときだけ効く。単独 transition の意味論は G1 で決める */
  transition?: 'cut' | 'fade' | 'flash'
  /** 背景が切り替わるページにだけ載る（先頭ページには必ず載る） */
  bg?: string
  /** 立ち絵の舞台が変わるページにだけ載る（その時点の**全景**。空配列 ＝ 全員退場） */
  stage?: ScenarioStageEntry[]
  units: (string | [string, string])[]
  /** 純本文（共有カード・オート送りの読み時間に使う） */
  text: string
}

export interface ScenarioBg {
  /** index.html からの相対パス */
  src: string
  label: string
  /** 上・中・下の3色（共有カードの下地） */
  tone: [string, string, string]
}

export interface GameScenario {
  v: 1
  workTitle: string
  episodeTitle: string
  author?: string
  /** localStorage のセーブキー（作品×話で一意） */
  saveKey: string
  defaultBg: string
  bgs: Record<string, ScenarioBg>
  /** 立ち絵（キー → 実体パス）。使われているときだけ載る */
  sprites?: Record<string, { src: string; label: string }>
  /** 同梱フォント（無ければシステムの明朝で表示） */
  fontSrc?: string
  credits: CreditLine[]
  pages: ScenarioPage[]
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}

export function buildPlayerHtml(scenario: GameScenario): string {
  const title = escapeHtml(`${scenario.episodeTitle} — ${scenario.workTitle}`)
  // JSON を <script> に埋めるため < をエスケープ（</script> による脱出を防ぐ）
  const json = JSON.stringify(scenario).replace(/</g, '\\u003c')
  const fontFace = scenario.fontSrc
    ? `@font-face{font-family:'Shippori Mincho B1';src:url('${scenario.fontSrc}') format('woff2');font-weight:500;font-style:normal;font-display:swap}`
    : ''
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<style>
${fontFace}
:root{--gold:#E8C88C;--ink:#EEF2FA;--dim:rgba(233,238,250,.55)}
html,body{height:100%;margin:0;background:#05060A}
#stage{position:fixed;inset:0;overflow:hidden;color:var(--ink);
  font-family:'Shippori Mincho B1','Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif;
  user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;
  touch-action:manipulation}
.bg{position:absolute;inset:-5%;background-size:cover;background-position:center;opacity:0;
  transition:opacity .9s ease}
.bg.kb{animation:kb 38s ease-in-out infinite alternate}
@keyframes kb{from{transform:scale(1) translate(0,0)}to{transform:scale(1.08) translate(-1.2%,.8%)}}
#sprites{position:absolute;inset:0;pointer-events:none}
#sprites img{position:absolute;bottom:0;transform:translateX(-50%);height:min(78vh,860px);
  max-width:min(58vw,560px);object-fit:contain;object-position:bottom center;opacity:1;
  transition:opacity .45s ease,left .5s ease,filter .35s ease}
#sprites img.p-c{left:50%}
#sprites img.p-l{left:26%}
#sprites img.p-r{left:74%}
#sprites img.dim{filter:brightness(.55) saturate(.85)}
#sprites img.in,#sprites img.out{opacity:0}
@media (prefers-reduced-motion:reduce){#sprites img{transition:opacity .45s ease}}
#flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
#flash.on{animation:fl .5s ease-out}
@keyframes fl{0%{opacity:.9}100%{opacity:0}}
#shade{position:absolute;inset:0;background:radial-gradient(120% 95% at 50% 10%,transparent 45%,rgba(0,0,0,.4) 100%);pointer-events:none}
#hud{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));right:calc(12px + env(safe-area-inset-right,0px));display:flex;gap:2px;z-index:4}
#hud button{background:none;border:0;padding:6px 8px;cursor:pointer;color:var(--dim);
  font-family:'Noto Sans JP','Hiragino Sans',sans-serif;font-size:11px;letter-spacing:.14em}
#hud button.on{color:var(--gold)}
#hud button.on::after{content:'●';font-size:6px;vertical-align:.35em;margin-left:3px}
#box{position:absolute;left:calc(4% + env(safe-area-inset-left,0px));right:calc(4% + env(safe-area-inset-right,0px));bottom:calc(4.5% + env(safe-area-inset-bottom,0px));
  background:rgba(7,11,22,.68);border:1px solid rgba(226,233,250,.16);border-radius:8px;
  padding:18px clamp(16px,3vw,30px) 20px;max-height:46vh;overflow-y:auto;z-index:2}
#name{color:var(--gold);letter-spacing:.22em;font-size:clamp(.85rem,1.6vw,1rem);margin:0 0 .5em;font-weight:600}
#text{margin:0;font-size:clamp(1.02rem,2.2vw,1.42rem);line-height:1.9;min-height:3.8em;font-weight:500;overflow-wrap:anywhere}
#line em.dots{font-style:normal;text-emphasis:filled dot;-webkit-text-emphasis:filled dot}
#next{display:inline-block;margin-left:.4em;font-size:.72em;color:var(--gold);animation:bl 1.4s steps(1) infinite}
@keyframes bl{0%,55%{opacity:1}56%,100%{opacity:.1}}
.overlay{position:absolute;inset:0;background:rgba(5,8,16,.82);z-index:6;display:flex;
  flex-direction:column;align-items:center;justify-content:center;text-align:center;
  padding:28px 20px;overflow-y:auto;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.overlay h2{font-size:1rem;letter-spacing:.3em;color:var(--dim);font-weight:600;margin:0 0 18px}
.t-work{color:var(--dim);letter-spacing:.2em;font-size:.9rem;margin:0 0 14px}
.t-ep{font-size:clamp(1.6rem,4.6vw,2.6rem);font-weight:600;letter-spacing:.06em;margin:0 0 10px;line-height:1.5}
.t-author{color:var(--dim);font-size:.9rem;margin:0 0 34px}
.t-mark{color:var(--dim);font-size:.72rem;letter-spacing:.12em;margin:40px 0 0}
.act{display:block;min-width:220px;margin:7px auto;background:none;color:var(--ink);cursor:pointer;
  border:1px solid rgba(233,238,250,.34);border-radius:999px;padding:.62em 2em;
  font-family:inherit;font-size:.95rem;letter-spacing:.12em}
.act:hover{background:rgba(255,255,255,.08)}
.hint{color:var(--dim);font-size:.78rem;margin:26px 0 0}
#logBody{width:min(680px,100%);margin:0 auto;text-align:left;flex:1 1 auto;overflow-y:auto}
.log-item{border-bottom:1px solid rgba(233,238,250,.12);padding:12px 4px}
.log-name{color:var(--gold);font-size:.82rem;letter-spacing:.18em;display:block;margin-bottom:4px}
.log-item p{margin:0;line-height:1.85;font-size:.95rem}
#menu .note,#credits .note{color:var(--dim);font-size:.8rem;line-height:1.9;margin:22px 0 0;max-width:420px}
.speed{display:flex;align-items:center;gap:10px;margin:0 0 18px;color:var(--dim);font-size:.82rem}
.speed input{width:180px;accent-color:var(--gold)}
.credit-line{max-width:560px;margin:0 0 14px;text-align:left}
.credit-line b{display:block;color:var(--dim);font-size:.74rem;letter-spacing:.2em;font-weight:600;margin-bottom:2px}
.credit-line span{font-size:.9rem;line-height:1.8}
#end .fin{font-size:clamp(2rem,6vw,3rem);letter-spacing:.3em;margin:0 0 8px;font-weight:600}
#msg{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);background:rgba(7,11,22,.85);
  border:1px solid rgba(226,233,250,.2);border-radius:6px;color:var(--ink);font-size:.85rem;
  padding:.55em 1.2em;opacity:0;transition:opacity .3s;pointer-events:none;z-index:8;white-space:nowrap}
#msg.on{opacity:1}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){.bg.kb,#next{animation:none}}
</style>
</head>
<body>
<div id="stage">
  <div id="bgA" class="bg"></div>
  <div id="bgB" class="bg"></div>
  <div id="sprites"></div>
  <div id="shade"></div>
  <div id="flash"></div>
  <div id="hud" hidden>
    <button id="btnAuto" type="button">オート</button>
    <button id="btnSkip" type="button">スキップ</button>
    <button id="btnLog" type="button">ログ</button>
    <button id="btnMenu" type="button">メニュー</button>
  </div>
  <div id="box" hidden>
    <p id="name" hidden></p>
    <p id="text"><span id="line"></span><span id="next" hidden>▼</span></p>
  </div>
  <div id="ovTitle" class="overlay">
    <p class="t-work"></p>
    <h1 class="t-ep"></h1>
    <p class="t-author" hidden></p>
    <button id="btnContinue" class="act" type="button" hidden>つづきから</button>
    <button id="btnStart" class="act" type="button">はじめから</button>
    <p class="hint">タップかクリックで読み進めます</p>
    <p class="t-mark">コトノハ-leaf-</p>
  </div>
  <div id="ovLog" class="overlay" hidden>
    <h2>ログ</h2>
    <div id="logBody"></div>
    <button class="act close" type="button">閉じる</button>
  </div>
  <div id="ovMenu" class="overlay" hidden>
    <h2>メニュー</h2>
    <div class="speed"><span>ゆっくり</span><input id="speed" type="range" min="1" max="5" step="1"><span>はやい</span></div>
    <button id="btnCard" class="act" type="button">この一文をカードにする</button>
    <button id="btnCredits" class="act" type="button">クレジット</button>
    <button id="btnRestart" class="act" type="button">はじめから読み直す</button>
    <button class="act close" type="button">閉じる</button>
    <p class="note">読んだところまでは、この端末に自動で保存されます。</p>
  </div>
  <div id="ovCredits" class="overlay" hidden>
    <h2>クレジット</h2>
    <div id="creditBody"></div>
    <button class="act close" type="button">閉じる</button>
  </div>
  <div id="ovEnd" class="overlay" hidden>
    <p class="fin">了</p>
    <p class="t-work"></p>
    <button id="btnEndCard" class="act" type="button">一行カードをつくる</button>
    <button id="btnAgain" class="act" type="button">もう一度読む</button>
    <button id="btnEndCredits" class="act" type="button">クレジット</button>
  </div>
  <div id="msg"></div>
</div>
<script id="scenario" type="application/json">${json}</script>
<script>
(function () {
  'use strict'
  var S = JSON.parse(document.getElementById('scenario').textContent)
  function $(id) { return document.getElementById(id) }
  var bgA = $('bgA'), bgB = $('bgB'), flashEl = $('flash'), hud = $('hud')
  var spritesEl = $('sprites')
  var box = $('box'), nameEl = $('name'), lineEl = $('line'), nextEl = $('next')
  var overlays = { title: $('ovTitle'), log: $('ovLog'), menu: $('ovMenu'), credits: $('ovCredits'), end: $('ovEnd') }
  var SETTINGS_KEY = 'kotonoha:novel-game:settings'
  var SPEEDS = [72, 50, 34, 22, 13] // ゆっくり → はやい（1コマの ms）
  var settings = { speed: 3 }
  var state = { i: -1, maxSeen: -1, typing: false, timer: 0, unitIdx: 0,
    auto: false, skip: false, front: 'A', bgKey: '', started: false }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
    })
  }
  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch (e) { return null }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
  }

  var stored = loadJson(SETTINGS_KEY)
  if (stored && stored.speed >= 1 && stored.speed <= 5) settings.speed = stored.speed

  function unitHtml(u) { return typeof u === 'string' ? u : u[0] }
  function unitText(u) { return typeof u === 'string' ? u : u[1] }
  function pageHtml(p) { return p.units.map(unitHtml).join('') }

  function overlayOpen() {
    for (var k in overlays) { if (!overlays[k].hidden) return true }
    return false
  }
  function openOverlay(name) {
    for (var k in overlays) overlays[k].hidden = k !== name
  }
  function closeOverlays() {
    for (var k in overlays) overlays[k].hidden = true
  }

  // ---- 背景（二枚のレイヤをクロスフェード。パツンと切り替えない） ----
  function bgAt(i) {
    var key = S.defaultBg
    for (var j = 0; j <= i && j < S.pages.length; j++) { if (S.pages[j].bg) key = S.pages[j].bg }
    return key
  }
  function setBg(key, transition, instant) {
    if (key === state.bgKey || !S.bgs[key]) return
    state.bgKey = key
    var front = state.front === 'A' ? bgA : bgB
    var back = state.front === 'A' ? bgB : bgA
    back.style.backgroundImage = 'url("' + S.bgs[key].src + '")'
    back.classList.remove('kb'); void back.offsetWidth; back.classList.add('kb')
    if (instant || transition === 'cut' || transition === 'flash') {
      back.style.transition = 'none'; front.style.transition = 'none'
      back.style.opacity = '1'; front.style.opacity = '0'
      requestAnimationFrame(function () { back.style.transition = ''; front.style.transition = '' })
    } else {
      back.style.opacity = '1'; front.style.opacity = '0'
    }
    if (transition === 'flash') {
      flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on')
    }
    state.front = state.front === 'A' ? 'B' : 'A'
  }

  // ---- 立ち絵の舞台（最大2人。exporter が話者から stage マーカーへ解決済み） ----
  function stageAt(i) {
    var st = []
    for (var j = 0; j <= i && j < S.pages.length; j++) {
      if (S.pages[j].stage) st = S.pages[j].stage
    }
    return st
  }
  function noTrans(el) {
    el.style.transition = 'none'
    requestAnimationFrame(function () { el.style.transition = '' })
  }
  function applyStage(list, instant) {
    var want = {}
    for (var i = 0; i < list.length; i++) want[list[i].k] = list[i]
    // 既存の立ち絵を更新（位置・明暗）、要らなくなった分は退場
    var imgs = spritesEl.querySelectorAll('img')
    for (var j = 0; j < imgs.length; j++) {
      var img = imgs[j]
      // 退場アニメ中の分は「もういない」扱い（再入場は新しい img で来る＝すれ違いのクロスフェード）
      if (img.classList.contains('out')) continue
      var entry = want[img.getAttribute('data-k')]
      if (!entry) {
        if (instant) { img.remove() }
        else {
          img.classList.add('out')
          ;(function (el) { setTimeout(function () { el.remove() }, 500) })(img)
        }
      } else {
        img.className = 'p-' + entry.p + (entry.a ? '' : ' dim')
        if (instant) noTrans(img)
        delete want[img.getAttribute('data-k')]
      }
    }
    // 新しく入場する分
    for (var k in want) {
      if (!(S.sprites && S.sprites[k])) continue
      var e = want[k]
      var el = document.createElement('img')
      el.setAttribute('data-k', k)
      el.src = S.sprites[k].src
      el.alt = S.sprites[k].label
      el.className = 'p-' + e.p + (e.a ? '' : ' dim') + (instant ? '' : ' in')
      spritesEl.appendChild(el)
      if (instant) noTrans(el)
      else {
        ;(function (node) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { node.classList.remove('in') })
          })
        })(el)
      }
    }
  }

  // ---- セーブ（進んだ分だけ自動で） ----
  function save() { saveJson(S.saveKey, { i: state.i, max: state.maxSeen, t: Date.now() }) }
  function loadSave() {
    var d = loadJson(S.saveKey)
    if (d && typeof d.i === 'number' && d.i > 0 && d.i < S.pages.length) return d
    return null
  }

  // ---- 文字送り（句読点で微小停止、…で長め、間で一拍） ----
  function pauseAfter(text) {
    var last = text.charAt(text.length - 1)
    if (last === '、') return 140
    if ('。！？!?」』'.indexOf(last) >= 0) return 240
    if ('…‥―—'.indexOf(last) >= 0) return 330
    return 0
  }
  function showPage(i, instant) {
    var p = S.pages[i]
    state.i = i
    if (i > state.maxSeen) state.maxSeen = i
    save()
    clearTimeout(state.timer)
    setBg(bgAt(i), p.bg ? p.transition : undefined, instant)
    applyStage(stageAt(i), instant)
    box.hidden = false
    if (p.kind === 'dialogue' && p.speaker) { nameEl.textContent = p.speaker; nameEl.hidden = false }
    else { nameEl.hidden = true }
    lineEl.innerHTML = ''
    nextEl.hidden = true
    if (instant || state.skip) {
      finishTyping()
      if (state.skip) queueSkip()
      return
    }
    state.typing = true
    state.unitIdx = 0
    var beat = p.beat ? Math.min(760, 280 * p.beat) : 0
    state.timer = setTimeout(tick, beat + 40)
  }
  function tick() {
    var p = S.pages[state.i]
    if (state.unitIdx >= p.units.length) { typingDone(); return }
    var u = p.units[state.unitIdx++]
    lineEl.insertAdjacentHTML('beforeend', unitHtml(u))
    if (box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight
    var t = unitText(u)
    state.timer = setTimeout(tick, SPEEDS[settings.speed - 1] * Math.max(1, t.length) + pauseAfter(t))
  }
  function finishTyping() {
    clearTimeout(state.timer)
    lineEl.innerHTML = pageHtml(S.pages[state.i])
    if (box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight
    typingDone()
  }
  function typingDone() {
    state.typing = false
    nextEl.hidden = false
    if (state.auto) {
      clearTimeout(state.timer)
      state.timer = setTimeout(function () {
        if (state.auto && !state.typing && !overlayOpen() && !document.hidden) advance()
      }, 420 + S.pages[state.i].text.length * 26)
    }
  }
  function queueSkip() {
    clearTimeout(state.timer)
    state.timer = setTimeout(function () {
      if (!state.skip || overlayOpen() || document.hidden) return
      if (state.i + 1 < S.pages.length) showPage(state.i + 1)
      else { toggleSkip(false); showEnd() }
    }, 85)
  }
  // オーバーレイを閉じた・タブへ戻った後に、オート／スキップの進行を張り直す
  function resumeFlow() {
    if (!state.started || overlayOpen()) return
    if (state.auto && !state.typing) typingDone()
    if (state.skip) queueSkip()
  }
  function advance() {
    if (!state.started || overlayOpen()) return
    if (state.typing) { finishTyping(); return }
    if (state.i + 1 < S.pages.length) showPage(state.i + 1)
    else showEnd()
  }

  // ---- オート・スキップ ----
  function toggleAuto(on) {
    state.auto = on === undefined ? !state.auto : on
    $('btnAuto').classList.toggle('on', state.auto)
    if (state.auto && !state.typing && !overlayOpen()) typingDone()
    if (state.auto) toggleSkip(false)
  }
  function toggleSkip(on) {
    var next = on === undefined ? !state.skip : on
    if (next === state.skip) return
    state.skip = next
    $('btnSkip').classList.toggle('on', state.skip)
    if (state.skip) {
      state.auto = false; $('btnAuto').classList.remove('on')
      if (state.started && !overlayOpen()) { finishTyping(); queueSkip() }
    }
  }

  // ---- ログ ----
  function openLog() {
    var html = ''
    for (var j = 0; j <= state.maxSeen && j < S.pages.length; j++) {
      var p = S.pages[j]
      html += '<div class="log-item">'
      if (p.kind === 'dialogue' && p.speaker) html += '<span class="log-name">' + esc(p.speaker) + '</span>'
      html += '<p>' + pageHtml(p) + '</p></div>'
    }
    $('logBody').innerHTML = html
    openOverlay('log')
    var body = $('logBody'); body.scrollTop = body.scrollHeight
  }

  // ---- クレジット（同梱素材から自動生成された一覧を表示するだけ） ----
  function renderCredits() {
    var html = ''
    for (var j = 0; j < S.credits.length; j++) {
      var c = S.credits[j]
      html += '<div class="credit-line"><b>' + esc(c.label) + '</b><span>' + esc(c.body) + '</span></div>'
    }
    $('creditBody').innerHTML = html
  }

  // ---- 一行カード（Canvas。サーバ不要・素材に触れない下地なので file:// でも汚染しない） ----
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16)
    return 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)
  }
  function wrapText(ctx, text, maxWidth) {
    // Array.from＝コードポイント単位。サロゲートペア（絵文字・拡張漢字）を行間で割らない
    var chars = Array.from(text)
    var lines = []
    var line = ''
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i]
      if (ctx.measureText(line + ch).width > maxWidth && line !== '') { lines.push(line); line = ch }
      else line += ch
    }
    if (line !== '') lines.push(line)
    return lines
  }
  function makeCard() {
    var p = S.pages[Math.max(0, state.i)]
    if (!p) return
    var bg = S.bgs[bgAt(Math.max(0, state.i))] || S.bgs[S.defaultBg]
    var tone = bg ? bg.tone : ['#141A30', '#232B49', '#3A4568']
    var W = 1200, H = 630
    var cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    var ctx = cv.getContext('2d')
    var g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, tone[0]); g.addColorStop(0.55, tone[1]); g.addColorStop(1, tone[2])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    var v = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.2, W / 2, H * 0.42, W * 0.75)
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.34)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)
    var dark = luminance(tone[1]) < 150
    var ink = dark ? '#F2F5FC' : '#1E2430'
    var sub = dark ? 'rgba(242,245,252,.72)' : 'rgba(30,36,48,.72)'
    var serif = "'Shippori Mincho B1','Hiragino Mincho ProN','Yu Mincho',serif"
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = sub
    ctx.font = '500 26px ' + serif
    ctx.fillText(S.workTitle, 80, 96)
    var size = 46
    var lines
    while (true) {
      ctx.font = '500 ' + size + 'px ' + serif
      lines = wrapText(ctx, p.text, W - 160)
      if (lines.length <= 4 || size <= 30) break
      size -= 4
    }
    if (lines.length > 4) {
      lines = lines.slice(0, 4)
      var lastChars = Array.from(lines[3])
      lastChars.pop()
      lines[3] = lastChars.join('') + '…'
    }
    ctx.fillStyle = ink
    var lh = size * 1.9
    var y0 = H / 2 - ((lines.length - 1) * lh) / 2 + size * 0.35
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], 80, y0 + i * lh)
    ctx.fillStyle = sub
    ctx.font = '500 24px ' + serif
    var foot = S.episodeTitle + (S.author ? '　' + S.author : '')
    ctx.fillText(foot, 80, H - 64)
    ctx.font = '500 20px ' + serif
    var mark = 'コトノハ-leaf-'
    ctx.fillText(mark, W - 80 - ctx.measureText(mark).width, H - 64)
    cv.toBlob(function (blob) {
      if (!blob) { msg('カードを作れませんでした'); return }
      shareCard(blob, p)
    }, 'image/png')
  }
  function downloadCard(blob, text) {
    var a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'card.png'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(function () { URL.revokeObjectURL(a.href) }, 5000)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { msg('画像を保存し、本文をコピーしました') }, function () { msg('画像を保存しました') })
    } else msg('画像を保存しました')
  }
  function shareCard(blob, p) {
    var file
    try { file = new File([blob], 'card.png', { type: 'image/png' }) } catch (e) { file = null }
    var text = p.text + ' — ' + S.workTitle + '「' + S.episodeTitle + '」'
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      // 共有シートを閉じた（AbortError）ときは何もしない。それ以外の失敗は保存へ倒す
      navigator.share({ files: [file], text: text }).catch(function (err) {
        if (!err || err.name !== 'AbortError') downloadCard(blob, text)
      })
      return
    }
    downloadCard(blob, text)
  }
  function card() {
    var run = function () { makeCard() }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run, run)
    else run()
  }

  var msgTimer = 0
  function msg(text) {
    var el = $('msg')
    el.textContent = text
    el.classList.add('on')
    clearTimeout(msgTimer)
    msgTimer = setTimeout(function () { el.classList.remove('on') }, 2600)
  }

  // ---- 進行 ----
  function start(i) {
    closeOverlays()
    hud.hidden = false
    state.started = true
    if (S.pages.length === 0) { showEnd(); return }
    showPage(i)
  }
  function showEnd() {
    toggleAuto(false); toggleSkip(false)
    openOverlay('end')
  }

  // ---- 配線 ----
  var titleOv = overlays.title
  titleOv.querySelector('.t-work').textContent = S.workTitle
  titleOv.querySelector('.t-ep').textContent = S.episodeTitle
  if (S.author) {
    var au = titleOv.querySelector('.t-author')
    au.textContent = S.author
    au.hidden = false
  }
  overlays.end.querySelector('.t-work').textContent = S.workTitle + '「' + S.episodeTitle + '」'
  renderCredits()
  var saved = loadSave()
  if (saved) $('btnContinue').hidden = false
  $('btnStart').addEventListener('click', function () { start(0) })
  $('btnContinue').addEventListener('click', function () { start(saved ? saved.i : 0) })
  $('btnAgain').addEventListener('click', function () { start(0) })
  $('btnRestart').addEventListener('click', function () { start(0) })
  $('btnAuto').addEventListener('click', function () { toggleAuto() })
  $('btnSkip').addEventListener('click', function () { toggleSkip() })
  $('btnLog').addEventListener('click', openLog)
  $('btnMenu').addEventListener('click', function () {
    $('speed').value = String(settings.speed)
    openOverlay('menu')
  })
  $('btnCredits').addEventListener('click', function () { openOverlay('credits') })
  $('btnEndCredits').addEventListener('click', function () { openOverlay('credits') })
  $('btnCard').addEventListener('click', function () { closeOverlays(); card(); resumeFlow() })
  $('btnEndCard').addEventListener('click', card)
  $('speed').addEventListener('input', function (e) {
    settings.speed = Number(e.target.value) || 3
    saveJson(SETTINGS_KEY, settings)
  })
  var closes = document.querySelectorAll('.close')
  for (var ci = 0; ci < closes.length; ci++) {
    closes[ci].addEventListener('click', function () {
      closeOverlays()
      resumeFlow()
    })
  }
  $('stage').addEventListener('click', function (e) {
    if (e.target.closest('button') || e.target.closest('.overlay') || e.target.closest('#hud')) return
    advance()
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!overlays.title.hidden || !overlays.end.hidden) return
      closeOverlays()
      resumeFlow()
      return
    }
    // フォーカスがボタン等にあるときは奪わない（キーボードだけで HUD を操作できるように）
    if (e.target && e.target.closest && e.target.closest('button, input, a')) return
    if ((e.key === 'Enter' || e.key === ' ') && !overlayOpen()) {
      e.preventDefault()
      advance()
    }
  })
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) resumeFlow()
  })

  // 先頭ページの背景をタイトル画面の借景にする
  setBg(bgAt(0), undefined, true)
})()
</script>
</body>
</html>
`
}
