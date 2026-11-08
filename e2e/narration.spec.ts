import { readFileSync } from 'node:fs'
import { expect,test, type Page } from '@playwright/test'
import { emptyNarration, type VoiceTake } from '../src/core/narration/types'
import { resolveSegments } from '../src/core/narration/resolve'
async function selectReadingWord(page:Page,start:number,end:number){
 const picker=page.getByLabel('読みを直す語句を選択')
 await picker.scrollIntoViewIfNeeded()
 const points=await picker.evaluate((node,{start,end})=>{
  const el=node as HTMLTextAreaElement
  const style=getComputedStyle(el),r=el.getBoundingClientRect()
  const ctx=document.createElement('canvas').getContext('2d')!
  ctx.font=style.font
  const x=r.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft)
  const y=r.top+parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop)+parseFloat(style.lineHeight)/2
  return {x1:x+ctx.measureText(el.value.slice(0,start)).width,y,x2:x+ctx.measureText(el.value.slice(0,end)).width}
 },{start,end})
 await page.mouse.move(points.x1+0.5,points.y)
 await page.mouse.down()
 await page.mouse.move(points.x2-0.5,points.y,{steps:10})
 await page.mouse.up()
}
const title='その社へと続く道は、いつか聞いた懐かしい声と、まだ見ぬ明日へ続いている。'.repeat(3)
test('専用画面で複数の指示を保存し、再読込後も同じジョブと音声を使って書き出す',async({page})=>{
 test.setTimeout(60000)
 const takes:VoiceTake[]=[]
 let posts=0
 await page.route('**/api/narration*',async(route)=>{
  const request=route.request(),url=new URL(request.url())
  if(url.searchParams.get('action')==='audio'){await route.fulfill({contentType:'audio/mpeg',body:readFileSync('public/narration-samples/silence.mp3')});return}
  if(request.method()==='POST'){
   posts++
   const body=request.postDataJSON()
   for(const s of body.segments)takes.push({id:crypto.randomUUID(),jobId:body.id,segmentId:s.id,fingerprint:s.fingerprint,state:'generating',createdAt:Date.now()})
   await route.fulfill({status:202,json:{id:body.id}})
   return
  }
  await route.fulfill({json:{entitlement:{plan:'standard',label:'980円プラン',limit:10000,used:0,reserved:takes.length*6,remaining:10000-takes.length*6,preview:{remaining:5,limit:5,period:'preview:2026-11-07'},period:'2026-11',periodEnd:Date.now()+86400000,model:'s2.1-pro-free',development:true,enabled:true,voices:[{id:'default',label:'Shiori',description:'日本語',version:'1'}]},jobs:[...new Set(takes.map(t=>t.jobId))],takes}})
 })
 await page.goto('/')
 await page.evaluate(async(title)=>{
  localStorage.setItem('ns-onboarded','1')
  const request=indexedDB.open('novel-studio',1)
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite')
   tx.objectStore('kv').put({id:'narration-e2e',title,episodes:[{id:'episode',title,blocks:['私は鳥居を見上げた。','「おかえり」','「ただいま。会いたかった」'].map((text,i)=>({id:'b'+i,type:'paragraph',inlines:[{type:'text',text}]}))}]},'work:narration-e2e')
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  });db.close()
 },title)
 await page.goto('/#/narration/narration-e2e/episode')
 await expect(page.getByRole('heading',{name:'朗読制作',exact:true})).toBeVisible()
 await expect(page.locator('.narration-popover summary').first()).toContainText('残り 10,000文字')
 await page.screenshot({path:'test-results/narration-focused-initial.png',fullPage:true})
 await page.locator('.narration-popover summary').first().click()
 await expect(page.getByRole('region',{name:'利用枠'})).toBeVisible()
 await page.keyboard.press('Escape')
 await expect(page.getByRole('region',{name:'利用枠'})).toBeHidden()

 const usable=await page.locator('.narration-workspace').evaluate(el=>el.getBoundingClientRect().height/window.innerHeight)
 expect(usable).toBeGreaterThan(0.78)
 await expect(page.getByLabel('語り手の声')).toBeVisible()
 await page.getByRole('button',{name:'文2を選ぶ',exact:true}).click()
 await page.getByLabel('どう読んでほしい？').fill('そっとささやくように。懐かしさと喜びを隠しながら。'.repeat(4))
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await page.getByLabel('どう読んでほしい？').fill('少し寂しそうに。最後だけ温かく')
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByRole('button',{name:'文2を選ぶ',exact:true}).click()
 await expect(page.getByLabel('どう読んでほしい？')).toHaveValue(/そっとささやく/)
 for(const width of [1440,1024,768,390]){
  await page.setViewportSize({width,height:1000})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:`test-results/narration-${width}.png`,fullPage:true})
 }
 await page.setViewportSize({width:1440,height:1000})
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByRole('button',{name:/一話を生成/}).click()
 await expect(page.getByRole('dialog')).toBeVisible()
 expect(posts).toBe(0)
 await page.getByRole('button',{name:'キャンセル',exact:true}).click()
 await expect(page.getByRole('dialog')).toBeHidden()
 expect(posts).toBe(0)
 await page.getByRole('button',{name:/一話を生成/}).click()
 await page.getByRole('button',{name:'同意して生成',exact:true}).click()
 await expect.poll(()=>posts).toBe(1)
 await page.reload()
 await expect(page.getByText(/生成中：残り 4区間/)).toBeVisible()
 for(const take of takes)take.state='ready'
 await page.getByRole('button',{name:'通して聴く',exact:true}).waitFor()
 await expect(page.getByRole('button',{name:'通して聴く',exact:true})).toBeEnabled({timeout:10000})
 await page.getByRole('button',{name:'通して聴く',exact:true}).click()
 await expect(page.locator('.narration-player audio')).toHaveAttribute('src',/^blob:/)
 await expect(page.getByRole('button',{name:'MP3で保存',exact:true})).toBeEnabled()
 await page.locator('footer input[type=range]').focus()
 await page.keyboard.press('End')
 await page.locator('footer').getByRole('button',{name:'ここを直す',exact:true}).click()
 await expect(page.getByRole('button',{name:'文4を選ぶ',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.reload()
 await expect(page.getByRole('button',{name:'MP3で保存',exact:true})).toBeEnabled()
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'MP3で保存',exact:true}).click()
 expect((await download).suggestedFilename()).toMatch(/\.mp3$/)
 expect(posts).toBe(1)
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await expect(page.getByLabel('どう読んでほしい？')).toHaveValue('少し寂しそうに。最後だけ温かく')
 await page.getByRole('button',{name:/選択部分を修正して生成/}).click()
 await expect.poll(()=>posts).toBe(2)
 for(const take of takes) take.state='ready'
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toBeVisible({timeout:10000})
 await expect(page.locator('.narration-inspector audio')).toHaveAttribute('src',/^blob:/)
 await expect(page.locator('.narration-paragraph[data-narration-state=compare]')).toHaveCount(1)
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(3)
 await expect(page.getByText(/保存した指示/)).toHaveCount(0)
 const colors=await page.locator('.narration-paragraph[data-narration-state=compare]').evaluate(el=>({
  status:getComputedStyle(el.closest('.narration-block')!.querySelector('.narration-state-tag')!).backgroundColor,
  selected:getComputedStyle(el.querySelector('mark')!).backgroundColor,
 }))
 expect(colors.status).not.toBe(colors.selected)
 await expect(page.getByRole('slider',{name:'新しい読みの再生位置'})).toBeVisible()
 await page.locator('footer').getByRole('button',{name:'通して聴く',exact:true}).click()
 await expect(page.locator('footer').getByRole('button',{name:'一時停止',exact:true})).toBeVisible()
 await page.locator('footer').getByRole('button',{name:'一時停止',exact:true}).click()
 const fullPosition=await page.locator('footer input[type=range]').inputValue()
 await page.locator('.narration-inspector').getByRole('button',{name:'新しい読みを再生',exact:true}).click()
 expect(await page.locator('footer input[type=range]').inputValue()).toBe(fullPosition)
 await page.screenshot({path:'test-results/narration-comparison.png',fullPage:true})
 await page.evaluate(()=>document.documentElement.classList.add('dark'))
 await page.screenshot({path:'test-results/narration-comparison-dark.png',fullPage:true})
 await page.evaluate(()=>document.documentElement.classList.remove('dark'))
 await page.getByRole('button',{name:'元の読み',exact:true}).click()
 await page.getByRole('button',{name:'こちらを採用',exact:true}).click()
 expect(posts).toBe(2)
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByLabel('朗読スタイル').selectOption('quiet')
 await page.getByRole('link',{name:'執筆へ',exact:true}).click()
 await expect(page.getByRole('dialog')).toContainText('朗読の作業を中断しますか')
 await page.getByRole('button',{name:'作業を続ける',exact:true}).click()
 await page.getByRole('button',{name:/一話を再生成/}).click()
 await expect(page.getByRole('dialog')).toContainText('全区間の成功後に上書き')
 await page.getByRole('button',{name:'キャンセル',exact:true}).click()
 expect(posts).toBe(2)

 await expect(page.getByRole('dialog')).toBeHidden()
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await page.locator('.narration-reading summary').click()
 const picker=page.getByLabel('読みを直す語句を選択')
 await picker.click()
 await page.keyboard.press('Home')
 await page.keyboard.press('ArrowRight')
 await page.keyboard.down('Shift')
 for(let i=0;i<4;i++) await page.keyboard.press('ArrowRight')
 await page.keyboard.up('Shift')
 await expect(page.getByLabel('「ただいま」の読み仮名')).toBeVisible()
 await expect(page.locator('.narration-direction blockquote')).toHaveText('「ただいま。')
 await expect(page.locator('.narration-selection-bar')).toContainText('6文字を選択中')
 await page.keyboard.press('Escape')
 await expect(page.getByLabel('朗読スタイル')).toBeVisible()

})


test('長い原稿でもスタイルと速さ・間をまとめ、複数の声を本文から指定する',async({page})=>{
 await page.setViewportSize({width:1304,height:884})
 await page.route('**/api/narration*',route=>route.fulfill({json:{
  entitlement:{plan:'standard',label:'980円プラン',limit:10000,used:0,reserved:0,remaining:10000,
    preview:{remaining:5,limit:5,period:'preview:2026-11-07'},period:'2026-11',periodEnd:null,
    model:'s2.1-pro-free',development:true,enabled:true,voices:[
      {id:'default',label:'テスト用の声A',description:'テスト用',version:'1'},
      {id:'second',label:'テスト用の声B',description:'テスト用',version:'2'}]},
  jobs:[],takes:[]
 }}))
 await page.goto('/')
 await page.evaluate(async(title)=>{
  localStorage.setItem('ns-onboarded','1')
  const req=indexedDB.open('novel-studio',1)
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite')
   tx.objectStore('kv').put({id:'narration-long',title,glossary:[{id:'person',category:'人物',name:'用語集だけの人物',aliases:[],createdAt:1,updatedAt:1}],
     episodes:[{id:'episode',title,blocks:Array.from({length:40},(_,i)=>({
      id:'b'+i,type:'paragraph',inlines:[{type:'text',text:i%2===0?'風が木々を揺らしていた。遠くに見える社へと、ゆっくり歩いていく。':'「ずっと、この場所で待っていたんだよ。おかえりなさい」'}]}))}]},'work:narration-long')
   tx.objectStore('kv').put({workId:'narration-long',episodeId:'episode',updatedAt:1,cues:[{blockId:'b0',sceneBreak:true},{blockId:'b1',sceneBreak:true}]},'staging:narration-long:episode')
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  });db.close()
 },title)
 await page.goto('/#/narration/narration-long/episode')
 const inspector=page.locator('.narration-inspector')
 await expect(page.getByRole('heading',{name:'一話の声とスタイル'})).toBeVisible()
 await expect(page.getByRole('button',{name:'ひとり朗読',exact:true})).toHaveAttribute('aria-pressed','true')
 await expect(page.getByText('場面の切れ目',{exact:true})).toHaveCount(0)
 await expect(page.getByText('演技を添える',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('region',{name:'本文の色分け'})).toBeVisible()
 await expect(page.locator('.narration-paragraph[data-narration-state=empty]')).toHaveCount(80)
 await expect(page.locator('.narration-block')).toHaveCount(40)
 await expect(page.locator('.narration-block .narration-state-tag')).toHaveCount(40)
 const style=await page.getByLabel('朗読スタイル').boundingBox()
 const speed=await page.getByLabel('速さ').boundingBox()
 const gap=await page.getByLabel('段落のあとの間').boundingBox()
 const generate=await page.getByRole('button',{name:'一話を生成',exact:true}).boundingBox()
 expect(speed!.y-style!.y).toBeLessThan(100)
 expect(Math.abs(speed!.y-gap!.y)).toBeLessThan(2)
 expect(generate!.y+generate!.height).toBeLessThan(800)
 await expect(inspector.getByText('配役を設定',{exact:true})).toHaveCount(0)
 await expect(inspector.getByText('読み・声・間を細かく調整',{exact:true})).toHaveCount(0)
 await page.screenshot({path:'test-results/narration-long-solo.png',fullPage:true})
 await page.getByRole('button',{name:'複数の声',exact:true}).click()
 await expect(page.getByRole('heading',{name:'本文に声を付ける',exact:true})).toBeVisible()
 await expect(page.getByLabel('語り手の声')).toBeHidden()
 await page.screenshot({path:'test-results/narration-cast-overview.png',fullPage:true})
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await expect(page.getByRole('heading',{name:'この部分の読み方'})).toBeVisible()
 await expect(page.getByLabel('語り手の声')).toBeHidden()
 await expect(page.getByText('用語集だけの人物')).toHaveCount(0)
 await page.getByLabel('この部分の声').selectOption('second')
 await page.getByLabel('この部分のスタイル').selectOption('quiet')
 await page.getByLabel('速さ').selectOption('0.9')
 await page.getByLabel('どう読んでほしい？').fill('最後だけ、少しうれしそうに')
 await page.screenshot({path:'test-results/narration-long-multi.png',fullPage:true})
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.locator('.narration-voice-ranges button').filter({hasText:'テスト用の声B'}).click()
 await expect(page.getByLabel('この部分の声')).toHaveValue('second')
 await expect(page.getByLabel('この部分のスタイル')).toHaveValue('quiet')
 await page.getByRole('button',{name:'ひとり朗読',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveCount(0)
 await page.getByRole('button',{name:'複数の声',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveValue('second')
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.reload()
 await expect(page.getByRole('button',{name:'複数の声',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveValue('second')

 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await expect(page.locator('.narration-paragraph.is-selected')).toHaveCount(3)
 await page.getByRole('button',{name:'文2を選ぶ',exact:true}).click()
 await expect(page.getByRole('button',{name:'文1を選ぶ',exact:true})).toHaveAttribute('aria-pressed','true')
 await expect(page.getByRole('button',{name:'文2を選ぶ',exact:true})).toHaveAttribute('aria-pressed','false')
 await expect(page.getByRole('button',{name:'文3を選ぶ',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByLabel('どう読んでほしい？').fill('選んだ二文だけ静かに')
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.locator('.narration-instruction-link[title*="選んだ二文だけ静かに"]').first().click()
 await expect(page.locator('.narration-paragraph.is-selected')).toHaveCount(2)
 await expect(page.getByRole('button',{name:'文2を選ぶ',exact:true})).toHaveAttribute('aria-pressed','false')
 await page.getByRole('button',{name:'文2を選ぶ',exact:true}).click()
 await expect(page.locator('.narration-paragraph.is-selected')).toHaveCount(3)
 await page.getByRole('button',{name:'文2を選ぶ',exact:true}).click()
 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await expect(page.locator('.narration-paragraph.is-selected')).toHaveCount(1)
 await expect(page.getByRole('button',{name:'文3を選ぶ',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await expect(page.locator('.narration-paragraph.is-selected')).toHaveCount(0)
 const chooseWord = async () => {
  await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
  await page.locator('.narration-reading summary').click()
  await selectReadingWord(page,2,4)
 }
 await chooseWord()
 await expect(page.locator('.narration-direction blockquote')).toHaveText('風が木々を揺らしていた。')
 expect(await page.locator('[data-segment]').first().evaluate(el=>getComputedStyle(el).userSelect)).toBe('none')
 const reading=page.getByLabel('「木々」の読み仮名')
 await expect(reading).toBeVisible()
 await reading.fill('きぎ')
 await expect(page.locator('summary').filter({hasText:'読み方の修正'})).toHaveCount(1)
 await expect(page.locator('.narration-dictionary')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'読みを追加',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByText('この作品で使う読み',{exact:true}).click()
 await expect(page.locator('.narration-dictionary').getByLabel('表記',{exact:true})).toHaveValue('木々')
 await expect(page.locator('.narration-dictionary').getByLabel('読み',{exact:true})).toHaveValue('きぎ')
 await chooseWord()
 await expect(page.getByLabel('「木々」の読み仮名')).toHaveValue('きぎ')
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.locator('.narration-instruction-link').filter({hasText:'読み：きぎ'}).first().click()
 await expect(page.getByLabel('「木々」の読み仮名')).toHaveValue('きぎ')
 await expect(page.getByRole('button',{name:'通して聴く',exact:true})).toBeVisible()
 await expect(page.getByRole('slider',{name:'一話の読みの再生位置'})).toBeVisible()
 await expect(page.getByRole('button',{name:'ここを直す',exact:true})).toBeVisible()
 await page.screenshot({path:'test-results/narration-word-reading.png',fullPage:true})
 for(const width of [1024,768,390]){
  await page.setViewportSize({width,height:884})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  expect(await inspector.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  if(width===390) await page.getByRole('button',{name:'読み方',exact:true}).click()
  for(const selector of await page.locator('.narration-timing select:visible').all()){
   expect(await selector.evaluate(el=>{
    const select=el as HTMLSelectElement
    const style=getComputedStyle(select),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!
    ctx.font=style.font
    const widest=Math.max(...[...select.options].map(o=>ctx.measureText(o.text).width))
    return widest+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)<=select.clientWidth
   })).toBe(true)
  }
 }
 await page.getByRole('button',{name:'読み方',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toBeVisible()
 expect(await inspector.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.screenshot({path:'test-results/narration-long-mobile.png',fullPage:true})
 await page.setViewportSize({width:1304,height:884})
 await expect(page.getByText('保存済み',{exact:true})).toBeVisible()
 await page.evaluate(async()=>{
  const request=indexedDB.open('novel-studio',1)
  const db=await new Promise<IDBDatabase>((resolve)=>{request.onsuccess=()=>resolve(request.result)})
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv'),get=store.get('narration:local:narration-long')
   get.onsuccess=()=>{
    const record=get.result
    record.settings.cues.push({id:'legacy-reading',episodeId:'episode',scope:'range',refs:[{blockId:'b0',snapshot:'風が木々を揺らしていた。遠くに見える社へと、ゆっくり歩いていく。'}],reading:'かぜがきぎをゆらしていた。とおくへあるく。'})
    store.put(record,'narration:local:narration-long')
   }
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  })
  db.close()
 })
 await page.reload()
 await expect(page.locator('.narration-reading-review')).toContainText('かぜがきぎをゆらしていた。とおくへあるく。')
 await expect(page.getByRole('button',{name:'一話を生成',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'スタイルを試聴',exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'以前の読み指定を外す',exact:true}).click()
 await expect(page.getByRole('button',{name:'一話を生成',exact:true})).toBeEnabled()

})

test('一話生成前の部分音声は自動反映し、再生成した箇所だけ比較する',async({page})=>{
 test.setTimeout(60000)
 const takes:VoiceTake[]=[]
 let posts=0
 await page.route('**/api/narration*',async(route)=>{
  const request=route.request(),url=new URL(request.url())
  if(url.searchParams.get('action')==='audio'){await route.fulfill({contentType:'audio/mpeg',body:readFileSync('e2e/fixtures/narration-tone.mp3')});return}
  if(request.method()==='POST'){
   posts++
   const body=request.postDataJSON()
   for(const s of body.segments)takes.push({id:crypto.randomUUID(),jobId:body.id,segmentId:s.id,fingerprint:s.fingerprint,state:'generating',createdAt:Date.now()})
   await route.fulfill({status:202,json:{id:body.id}})
   return
  }
  await route.fulfill({json:{entitlement:{plan:'standard',label:'980円プラン',limit:10000,used:0,reserved:takes.length*6,remaining:10000-takes.length*6,preview:{remaining:5,limit:5,period:'preview:2026-11-07'},period:'2026-11',periodEnd:Date.now()+86400000,model:'s2.1-pro-free',development:true,enabled:true,voices:[{id:'default',label:'Shiori',description:'日本語',version:'1'}]},jobs:[...new Set(takes.map(t=>t.jobId))],takes}})
 })
 await page.goto('/')
 await page.evaluate(async(title)=>{
  localStorage.setItem('ns-onboarded','1')
  const request=indexedDB.open('novel-studio',1)
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite')
   tx.objectStore('kv').put({id:'narration-e2e',title,episodes:[{id:'episode',title,blocks:['私は鳥居を見上げた。風が吹いた。','「おかえり」','「ただいま。会いたかった」'].map((text,i)=>({id:'b'+i,type:'paragraph',inlines:[{type:'text',text}]}))}]},'work:narration-e2e')
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  });db.close()
 },title)
 await page.goto('/#/narration/narration-e2e/episode')

 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await page.getByRole('button',{name:'文2を選ぶ',exact:true}).click()
 await expect(page.locator('.narration-paragraph.is-selected')).toHaveCount(2)
 await page.getByRole('button',{name:'選択部分を生成',exact:true}).click()
 await page.getByRole('button',{name:'同意して生成',exact:true}).click()
 await expect.poll(()=>posts).toBe(1)
 for(const take of takes) take.state='ready'
 await expect(page.getByRole('button',{name:'選択部分を聴く',exact:true})).toBeVisible({timeout:10000})
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'新しい読み',exact:true})).toHaveCount(0)
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(2)
 await expect(page.locator('.narration-block').first().locator('.narration-state-tag')).toHaveCount(1)
 await page.getByRole('button',{name:'選択部分を聴く',exact:true}).click()
 await expect(page.locator('.narration-inspector audio')).toHaveAttribute('src',/^blob:/)
 await expect.poll(()=>page.locator('.narration-inspector audio').evaluate(el=>(el as HTMLAudioElement).duration)).toBeGreaterThan(0.9)
 expect(await page.locator('.narration-inspector audio').evaluate(el=>(el as HTMLAudioElement).duration)).toBeLessThan(1.1)
 await page.screenshot({path:'test-results/narration-first-recording.png',fullPage:true})
 await page.reload()
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(2)
 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await page.getByRole('button',{name:'文3を選ぶ',exact:true}).click()
 await page.getByRole('button',{name:'選択部分を修正して生成',exact:true}).click()
 await expect.poll(()=>posts).toBe(2)
 for(const take of takes) take.state='ready'
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toBeVisible({timeout:10000})
 await expect(page.locator('.narration-paragraph[data-narration-state=compare]')).toHaveCount(2)
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(1)
 await page.getByRole('button',{name:'元の読み',exact:true}).click()
 await page.getByRole('button',{name:'こちらを採用',exact:true}).click()
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(3)
 expect(posts).toBe(2)
})

test('一文の前半と後半の読みを別々に直しても、生成・置換は同じ一文だけ',async({page})=>{
 test.setTimeout(60000)
 const takes:VoiceTake[]=[]
 let posts=0
 const submitted:{segments:{id:string,text:string,characters:number}[]}[]=[]
 await page.route('**/api/narration*',async(route)=>{
  const request=route.request(),url=new URL(request.url())
  if(url.searchParams.get('action')==='audio'){await route.fulfill({contentType:'audio/mpeg',body:readFileSync('e2e/fixtures/narration-tone.mp3')});return}
  if(request.method()==='POST'){
   posts++
   const body=request.postDataJSON();submitted.push(body)
   for(const s of body.segments)takes.push({id:crypto.randomUUID(),jobId:body.id,segmentId:s.id,fingerprint:s.fingerprint,state:'generating',createdAt:Date.now()})
   await route.fulfill({status:202,json:{id:body.id}})
   return
  }
  await route.fulfill({json:{entitlement:{plan:'standard',label:'980円プラン',limit:10000,used:0,reserved:takes.length*6,remaining:10000-takes.length*6,preview:{remaining:5,limit:5,period:'preview:2026-11-07'},period:'2026-11',periodEnd:Date.now()+86400000,model:'s2.1-pro-free',development:true,enabled:true,voices:[{id:'default',label:'Shiori',description:'日本語',version:'1'}]},jobs:[...new Set(takes.map(t=>t.jobId))],takes}})
 })
 await page.goto('/')
 await page.evaluate(async(title)=>{
  localStorage.setItem('ns-onboarded','1')
  const request=indexedDB.open('novel-studio',1)
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite')
   tx.objectStore('kv').put({id:'narration-e2e',title,episodes:[{id:'episode',title,blocks:['お母さんは首にかけていたネックレスをわたしの首にかけてくれた。'].map((text,i)=>({id:'b'+i,type:'paragraph',inlines:[{type:'text',text}]}))}]},'work:narration-e2e')
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  });db.close()
 },title)
 await page.goto('/#/narration/narration-e2e/episode')

 const original='お母さんは首にかけていたネックレスをわたしの首にかけてくれた。'
 const split=original.indexOf('わたし')
 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await page.locator('.narration-reading summary').click()
 const choose = async (start:number,end:number)=>{
  await page.getByLabel('読みを直す語句を選択').click()
  await page.keyboard.press('Home')
  for(let i=0;i<start;i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.down('Shift')
  for(let i=start;i<end;i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.up('Shift')
 }
 await choose(0,split)
 await page.getByLabel('「'+original.slice(0,split)+'」の読み仮名').fill('おかあさんはくびにかけていたねっくれすを')
 await expect(page.locator('.narration-direction blockquote')).toHaveText(original)
 await expect(page.locator('.narration-selection-bar')).toContainText(original.length+'文字を選択中')
 await page.getByRole('button',{name:'選択部分を生成',exact:true}).click()
 await page.getByRole('button',{name:'同意して生成',exact:true}).click()
 await expect.poll(()=>posts).toBe(1)
 expect(submitted[0]!.segments).toHaveLength(1)
 expect(submitted[0]!.segments[0]!.text).toBe('おかあさんはくびにかけていたねっくれすをわたしの首にかけてくれた。')
 for(const take of takes)take.state='ready'
 await expect(page.getByRole('button',{name:'選択部分を聴く',exact:true})).toBeVisible({timeout:10000})
 await choose(split,original.length-1)
 await page.getByLabel('「'+original.slice(split,-1)+'」の読み仮名').fill('わたしのくびにかけてくれた')
 await page.getByRole('button',{name:'選択部分を修正して生成',exact:true}).click()
 await expect.poll(()=>posts).toBe(2)
 expect(submitted[1]!.segments).toHaveLength(1)
 expect(submitted[1]!.segments[0]!.id).toBe(submitted[0]!.segments[0]!.id)
 expect(submitted[1]!.segments[0]!.text).toBe('おかあさんはくびにかけていたねっくれすをわたしのくびにかけてくれた。')
 expect(submitted[1]!.segments[0]!.characters).toBe(original.length)
 for(const take of takes)take.state='ready'
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toBeVisible({timeout:10000})
 await page.getByRole('button',{name:'こちらを採用',exact:true}).click()
 await page.getByRole('button',{name:'選択部分を聴く',exact:true}).click()
 await expect.poll(()=>page.locator('.narration-inspector audio').evaluate(el=>(el as HTMLAudioElement).duration)).toBeGreaterThan(0.4)
 expect(await page.locator('.narration-inspector audio').evaluate(el=>(el as HTMLAudioElement).duration)).toBeLessThan(0.6)
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(1)
})


test('旧セリフ音声は一話再生成が成功するまで保持し、新しい文単位に移行する',async({page})=>{
 const work={id:'legacy-audio',title:'旧音声',episodes:[{id:'episode',title:'話',blocks:[{id:'b0',type:'paragraph' as const,inlines:[{type:'text' as const,text:'「朝。夜。」'}]}]}]}
 const record=emptyNarration(work.id)
 const old=resolveSegments(work.episodes[0]!,record.settings,undefined,{model:'s2.1-pro-free',voices:[{id:'default',version:'1'}],legacy:true})
 record.snapshots={episode:old}
 record.takes=old.map((s)=>({id:'old-take',segmentId:s.id,fingerprint:s.fingerprint,state:'ready' as const,jobId:'old-job',createdAt:1}))
 record.accepted={[old[0]!.id]:'old-take'}
 const takes=[...record.takes]
 let posts=0
 await page.route('**/api/narration*',async(route)=>{
  if(new URL(route.request().url()).searchParams.get('action')==='audio'){
   await route.fulfill({contentType:'audio/mpeg',body:readFileSync('e2e/fixtures/narration-tone.mp3')});return
  }
  if(route.request().method()==='POST'){
   posts++
   const body=route.request().postDataJSON()
   for(const part of body.segments) takes.push({id:crypto.randomUUID(),segmentId:part.id,fingerprint:part.fingerprint,jobId:body.id,state:'ready',createdAt:2})
   await route.fulfill({status:202,json:{id:body.id}});return
  }
  await route.fulfill({json:{entitlement:{plan:'standard',label:'980円プラン',limit:10000,used:0,reserved:0,remaining:10000,preview:{remaining:5,limit:5},period:'2026-11',periodEnd:null,model:'s2.1-pro-free',enabled:true,development:true,voices:[{id:'default',label:'Shiori',description:'日本語',version:'1'}]},jobs:[],takes}})
 })
 await page.goto('/')
 await page.evaluate(async({work,record})=>{
  localStorage.setItem('ns-onboarded','1')
  localStorage.setItem('ns-narration-consent','1')
  const req=indexedDB.open('novel-studio',1)
  const db=await new Promise<IDBDatabase>((resolve)=>{req.onsuccess=()=>resolve(req.result)})
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv')
   store.put(work,'work:'+work.id)
   store.put(record,'narration:local:'+work.id)
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  });db.close()
 },{work,record})
 await page.goto('/#/narration/legacy-audio/episode')
 await expect(page.getByRole('button',{name:'通して聴く',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await expect(page.getByRole('button',{name:'選択部分を生成',exact:true})).toBeDisabled()
 await expect(page.getByText(/前回の音声と文の区切りが異なります。選択を解除/)).toBeVisible()
 expect(posts).toBe(0)
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByRole('button',{name:'一話を再生成',exact:true}).click()
 await page.getByRole('dialog').getByRole('button',{name:'同意して生成',exact:true}).click()
 await expect.poll(()=>posts).toBe(1)
 await expect(page.locator('.narration-paragraph[data-narration-state=ready]')).toHaveCount(2)
 await page.getByRole('button',{name:'文1を選ぶ',exact:true}).click()
 await expect(page.getByRole('button',{name:'選択部分を修正して生成',exact:true})).toBeEnabled()
 await page.getByText('以前の生成音声',{exact:true}).click()
 await expect(page.getByRole('button',{name:'聴く',exact:true})).toBeVisible()
})
