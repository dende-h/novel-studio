// 紹介動画用の重ね表示（テロップ・タイトル・マウスの位置）。録画のときだけ注入する。
(() => {
  const css = `
  #promo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
    background:rgba(44,91,39,.28);border:2px solid #2c5b27;z-index:2147483647;pointer-events:none;
    transition:transform .32s cubic-bezier(.3,.7,.2,1);transform:translate(640px,420px)}
  #promo-cursor.down{background:rgba(44,91,39,.55)}
  .promo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #2c5b27;
    z-index:2147483646;pointer-events:none;animation:promo-r .45s ease-out forwards}
  @keyframes promo-r{from{opacity:.8;transform:scale(.4)}to{opacity:0;transform:scale(1.4)}}
  #promo-caption{position:fixed;left:50%;bottom:34px;transform:translate(-50%,8px);max-width:86%;padding:12px 26px;
    border-radius:14px;background:rgba(26,48,20,.9);color:#fff;font:600 23px/1.5 "Noto Sans JP Variable","Hiragino Sans",sans-serif;
    letter-spacing:.03em;z-index:2147483645;pointer-events:none;opacity:0;transition:opacity .28s,transform .28s;
    box-shadow:0 6px 24px rgba(0,0,0,.18);white-space:nowrap}
  #promo-caption.on{opacity:1;transform:translate(-50%,0)}
  #promo-card{position:fixed;inset:0;background:#fdfcfb;z-index:2147483644;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:18px;opacity:0;transition:opacity .45s;pointer-events:none;text-align:center}
  #promo-card.on{opacity:1}
  #promo-card .k{font:600 18px/1.4 "Noto Sans JP Variable",sans-serif;color:#92703f;letter-spacing:.2em}
  #promo-card .t{font-size:42px;line-height:1.5;color:#1a3014;letter-spacing:.04em}
  #promo-card .b{font-size:30px;color:#2c5b27;letter-spacing:.06em}
  #promo-card .s{font:500 18px/1.6 "Noto Sans JP Variable",sans-serif;color:#6b7381}
  `
  const ready = () => {
    if (document.getElementById('promo-cursor')) return
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style)
    const cur = document.createElement('div'); cur.id = 'promo-cursor'; document.body.appendChild(cur)
    const cap = document.createElement('div'); cap.id = 'promo-caption'; document.body.appendChild(cap)
    const card = document.createElement('div'); card.id = 'promo-card'; document.body.appendChild(card)
    document.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)` }, true)
    document.addEventListener('mousedown', (e) => {
      cur.classList.add('down')
      const r = document.createElement('div'); r.className = 'promo-ripple'
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
      document.body.appendChild(r); setTimeout(() => r.remove(), 500)
    }, true)
    document.addEventListener('mouseup', () => cur.classList.remove('down'), true)
    window.__promo = {
      caption(text) {
        if (!text) { cap.classList.remove('on'); return }
        cap.classList.remove('on')
        setTimeout(() => { cap.textContent = text; cap.classList.add('on') }, cap.textContent ? 200 : 0)
      },
      card(html) {
        if (!html) { card.classList.remove('on'); return }
        card.innerHTML = html; card.classList.add('on')
      },
      cursor(on) { cur.style.display = on ? '' : 'none' },
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
  else ready()
})()
