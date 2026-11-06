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
 await page.getByLabel('どんなふうに読んでほしいですか？').fill('そっとささやくように。懐かしさと喜びを隠しながら。'.repeat(4))
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await page.getByLabel('どんなふうに読んでほしいですか？').fill('少し寂しそうに。最後だけ温かく')
 await page.getByRole('button',{name:'文章2を選ぶ',exact:true}).click()
 await expect(page.getByLabel('どんなふうに読んでほしいですか？')).toHaveValue(/そっとささやく/)
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
 await expect(page.getByRole('button',{name:'MP3を書き出す',exact:true})).toBeEnabled()
 await page.reload()
 await expect(page.getByRole('button',{name:'MP3を書き出す',exact:true})).toBeEnabled()
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'MP3を書き出す',exact:true}).click()
 expect((await download).suggestedFilename()).toMatch(/\.mp3$/)
 expect(posts).toBe(1)
 await page.getByRole('button',{name:'文章3を選ぶ',exact:true}).click()
 await expect(page.getByLabel('どんなふうに読んでほしいですか？')).toHaveValue('少し寂しそうに。最後だけ温かく')
 await page.getByRole('button',{name:/選択部分を修正して生成/}).click()
 await expect.poll(()=>posts).toBe(2)
 for(const take of takes) take.state='ready'
 await expect(page.getByRole('button',{name:'こちらを採用',exact:true})).toBeVisible({timeout:10000})
 await expect(page.locator('.narration-inspector audio')).toHaveAttribute('src',/^blob:/)
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

})
