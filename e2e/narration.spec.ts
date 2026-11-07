import { readFileSync } from 'node:fs'
import { expect,test } from '@playwright/test'
import type { VoiceTake } from '../src/core/narration/types'
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
 expect(usable).toBeGreaterThan(0.8)
 await expect(page.getByLabel('語り手の声')).toBeVisible()
 await page.getByRole('button',{name:'文章2を選ぶ',exact:true}).click()
 await page.getByLabel('どう読んでほしい？').fill('そっとささやくように。懐かしさと喜びを隠しながら。'.repeat(4))
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await page.getByLabel('どう読んでほしい？').fill('少し寂しそうに。最後だけ温かく')
 await page.getByRole('button',{name:'文章2を選ぶ',exact:true}).click()
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
 await expect(page.getByText(/生成中：残り 3区間/)).toBeVisible()
 for(const take of takes)take.state='ready'
 await page.getByRole('button',{name:'通して聴く',exact:true}).waitFor()
 await expect(page.getByRole('button',{name:'通して聴く',exact:true})).toBeEnabled({timeout:10000})
 await page.getByRole('button',{name:'通して聴く',exact:true}).click()
 await expect(page.locator('.narration-player audio')).toHaveAttribute('src',/^blob:/)
 await expect(page.getByRole('button',{name:'MP3で保存',exact:true})).toBeEnabled()
 await page.reload()
 await expect(page.getByRole('button',{name:'MP3で保存',exact:true})).toBeEnabled()
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'MP3で保存',exact:true}).click()
 expect((await download).suggestedFilename()).toMatch(/\.mp3$/)
 expect(posts).toBe(1)
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await expect(page.getByLabel('どう読んでほしい？')).toHaveValue('少し寂しそうに。最後だけ温かく')
 await page.getByRole('button',{name:/選択部分を修正して生成/}).click()
 await expect.poll(()=>posts).toBe(2)
 for(const take of takes) take.state='ready'
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toBeVisible({timeout:10000})
 await expect(page.locator('.narration-inspector audio')).toHaveAttribute('src',/^blob:/)
 await expect(page.getByRole('slider',{name:'新しい読みの再生位置'})).toBeVisible()
 await page.screenshot({path:'test-results/narration-comparison.png',fullPage:true})
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
 const coords=await page.locator('[data-segment]').nth(2).evaluate(el=>{
  const node=el.firstChild!
  const a=document.createRange(); a.setStart(node,1);a.setEnd(node,2)
  const b=document.createRange(); b.setStart(node,4);b.setEnd(node,5)
  const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect()
  return {x1:ar.left,y1:ar.top+ar.height/2,x2:br.right,y2:br.top+br.height/2}
 })
 await page.mouse.move(coords.x1,coords.y1)
 await page.mouse.down()
 await page.mouse.move(coords.x2,coords.y2,{steps:10})
 await page.mouse.up()
 await expect(page.locator('.narration-direction blockquote')).toContainText('ただいま')
 await expect(page.locator('.narration-selection-bar')).toContainText('4文字を選択中')
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
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)
  });db.close()
 },title)
 await page.goto('/#/narration/narration-long/episode')
 const inspector=page.locator('.narration-inspector')
 await expect(page.getByRole('heading',{name:'一話の声とスタイル'})).toBeVisible()
 await expect(page.getByRole('button',{name:'ひとり朗読',exact:true})).toHaveAttribute('aria-pressed','true')
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
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await expect(page.getByRole('heading',{name:'この部分の読み方'})).toBeVisible()
 await expect(page.getByLabel('語り手の声')).toBeHidden()
 await expect(page.getByText('用語集だけの人物')).toHaveCount(0)
 await page.getByLabel('この部分の声').selectOption('second')
 await page.getByLabel('この部分のスタイル').selectOption('quiet')
 await page.getByLabel('速さ').selectOption('0.9')
 await page.getByLabel('どう読んでほしい？').fill('最後だけ、少しうれしそうに')
 await page.screenshot({path:'test-results/narration-long-multi.png',fullPage:true})
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveValue('second')
 await expect(page.getByLabel('この部分のスタイル')).toHaveValue('quiet')
 await page.getByRole('button',{name:'ひとり朗読',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveCount(0)
 await page.getByRole('button',{name:'複数の声',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveValue('second')
 await page.getByRole('button',{name:'× 選択解除',exact:true}).click()
 await page.reload()
 await expect(page.getByRole('button',{name:'複数の声',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toHaveValue('second')
 for(const width of [1024,768,390]){
  await page.setViewportSize({width,height:884})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  expect(await inspector.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 }
 await page.getByRole('button',{name:'読み方',exact:true}).click()
 await expect(page.getByLabel('この部分の声')).toBeVisible()
 expect(await inspector.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.screenshot({path:'test-results/narration-long-mobile.png',fullPage:true})
})
