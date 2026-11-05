import { DurableObject } from 'cloudflare:workers'
interface Env { DB:D1Database; RUNNER:DurableObjectNamespace<NarrationRunner>; API_ORIGIN:string }
interface Dispatch {id:string;token:string}
export class NarrationRunner extends DurableObject<Env> {
 async fetch(request:Request) {
  const job=await request.json() as Dispatch
  await this.ctx.storage.put('job',job)
  if(await this.ctx.storage.getAlarm()===null) await this.ctx.storage.setAlarm(Date.now()+100)
  return new Response('queued')
 }
 async alarm() {
  const job=await this.ctx.storage.get<Dispatch>('job')
  if(!job) return
  // Set the next alarm before starting network I/O. A crashed request cannot strand a job.
  await this.ctx.storage.setAlarm(Date.now()+190_000)
  try {
   const response=await fetch(`${this.env.API_ORIGIN}/api/narration?action=run&job=${encodeURIComponent(job.id)}`,{
    method:'POST',headers:{authorization:`Bearer ${job.token}`},signal:AbortSignal.timeout(150_000),
   })
   if(response.ok && (await response.json() as {done:boolean}).done) {
    await this.ctx.storage.deleteAll()
    await this.ctx.storage.deleteAlarm()
    return
   }
  } catch { /* D1 prevents a provider call being repeated after an unknown result. */ }
  await this.ctx.storage.setAlarm(Date.now()+5000)
 }
}
export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const expired = (await env.DB.prepare("SELECT t.id,j.user_id FROM narration_takes t JOIN narration_jobs j ON j.id=t.job_id WHERE t.state='ready' AND t.expires_at<? LIMIT 500").bind(Date.now()).all<{id:string;user_id:string}>()).results
      for (const take of expired) {
        await env.MEDIA.delete(`${take.user_id}/narration/audio/${take.id}`)
        await env.DB.prepare("UPDATE narration_takes SET state='missing' WHERE id=? AND state='ready'").bind(take.id).run()
      }
      const old = (await env.DB.prepare("SELECT id,user_id,request_hash FROM narration_jobs WHERE created_at<? AND snapshot_removed=0 LIMIT 500").bind(Date.now()-30*86400000).all<{id:string;user_id:string;request_hash:string}>()).results
      for (const job of old) {
        await env.MEDIA.delete(`${job.user_id}/narration/${job.id}/${job.request_hash}/snapshot`)
        await env.DB.batch([
          env.DB.prepare("UPDATE narration_takes SET state='canceled' WHERE job_id=? AND state='queued'").bind(job.id),
          env.DB.prepare('UPDATE narration_jobs SET snapshot_removed=1 WHERE id=?').bind(job.id),
        ])
      }
    })())
  },
 async fetch(request:Request,env:Env) {
  if(request.method!=='POST'||new URL(request.url).pathname!=='/dispatch') return new Response('Not found',{status:404})
  const raw=await request.text()
  if(raw.length>300) return new Response('Bad request',{status:400})
  let job:Dispatch
  try {job=JSON.parse(raw)} catch {return new Response('Bad request',{status:400})}
  if(typeof job.id!=='string'||typeof job.token!=='string') return new Response('Bad request',{status:400})
  const valid=await env.DB.prepare('SELECT id FROM narration_jobs WHERE id=? AND dispatch_token=?').bind(job.id,job.token).first()
  if(!valid) return new Response('Not found',{status:404})
  return env.RUNNER.get(env.RUNNER.idFromName(job.id)).fetch(new Request('https://runner/',{method:'POST',body:raw}))
 },
}
