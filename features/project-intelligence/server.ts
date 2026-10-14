import {createServer,type IncomingMessage} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {telegramUser} from './auth.js';
import {ResearchService,createTracking,type Member} from './service.js';
import {createReader,chainConfig,type ProviderConfig} from './providers.js';
import {buildReport} from './build.js';
import {connectStore} from './store.js';
export async function start(){
 // Explicit opt-in and dedicated worker configuration. Never imported at bot startup.
 if(process.env.PROJECT_INTELLIGENCE_ENABLED!=='true')throw Error('Project Intelligence is disabled');
 const required=['PI_TELEGRAM_BOT_TOKEN','PI_REDIS_URL','PI_SUPABASE_URL','PI_SUPABASE_SERVICE_KEY','PI_ROBINHOOD_RPC_URL','PI_ARC_RPC_URL','PI_ROBINHOOD_EXPLORER_URL','PI_ARC_EXPLORER_URL'];
 for(const name of required)if(!process.env[name])throw Error(`Missing ${name}`);
 if(process.env.REDIS_URL&&process.env.REDIS_URL===process.env.PI_REDIS_URL)throw Error('Use a dedicated research Redis instance');
 const botToken=process.env.PI_TELEGRAM_BOT_TOKEN!;
 const config:ProviderConfig={rpc:{robinhood:process.env.PI_ROBINHOOD_RPC_URL!,arc:process.env.PI_ARC_RPC_URL!},explorer:{robinhood:process.env.PI_ROBINHOOD_EXPLORER_URL!,arc:process.env.PI_ARC_EXPLORER_URL!},explorerKey:process.env.PI_BLOCKSCOUT_KEY,securityKey:process.env.PI_GOPLUS_KEY,socialUrl:process.env.PI_SOCIAL_PROVIDER_URL,socialKey:process.env.PI_SOCIAL_PROVIDER_KEY};
 let window=0,requests=0;
 const admit=()=>{if(Date.now()-window>=60000){window=Date.now();requests=0;}return ++requests<=60;};
 const member=async(id:string):Promise<Member|null>=>{
  const base=new URL(process.env.PI_SUPABASE_URL!);if(base.protocol!=='https:')throw Error('Invalid membership provider');
  const url=new URL('/rest/v1/users',base);url.searchParams.set('select','telegram_id,tier,subscription_status,paid_active_until,is_blocked');url.searchParams.set('telegram_id',`eq.${id}`);url.searchParams.set('limit','1');
  const response=await fetch(url,{headers:{apikey:process.env.PI_SUPABASE_SERVICE_KEY!,Authorization:`Bearer ${process.env.PI_SUPABASE_SERVICE_KEY!}`},signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw Error('Membership verification unavailable');const rows=await response.json() as Member[];return rows.length===1&&String(rows[0].telegram_id)===id?rows[0]:null;
 };
 const service=new ResearchService({member,build:(chain,token)=>buildReport(chain,token,createReader(config,{signal:AbortSignal.timeout(30000),admit}))});
 const {store,close}=await connectStore(process.env.PI_REDIS_URL!);
 const tracking=createTracking({store,service,send:async(id,text)=>{
  const response=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:id,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(5000)});
  const result=await response.json() as any;if(!response.ok||result.ok!==true)throw Error('Tracking notification unconfirmed');
 }});
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 const body=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>16384)throw Error('Request too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString());};
 let apiInFlight=0;
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org");
  const reply=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='GET'&&req.url==='/health'){reply(200,{status:'running',feature:'project-intelligence',version:1});return;}
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;}
  if(req.method!=='POST'||!['/api/research','/api/track','/api/untrack','/api/tracks'].includes(req.url??'')){reply(404,{error:'Not found'});return;}
  if(apiInFlight>=4){reply(429,{error:'Research busy; try again shortly'});return;}apiInFlight++;
  try{
   const data=await body(req),id=telegramUser(data.initData,botToken);await service.authorize(id);
   if(req.url==='/api/research')reply(200,await service.report(id,data.chain,data.token));
   else if(req.url==='/api/track')reply(200,{id:await tracking.start(id,data.chain,data.token)});
   else if(req.url==='/api/untrack'){if(typeof data.id!=='string'||!/^[a-f0-9]{64}$/.test(data.id))throw Error('Invalid tracking record');await tracking.stop(id,data.id);reply(200,{stopped:true});}
   else reply(200,await tracking.list(id));
  }catch(e){const message=e instanceof Error?e.message:'';const safe=/^(?:Active Pro membership required|Authentication required|Invalid authentication|Authentication expired|Invalid token contract|Select Robinhood or ARC|Research busy; try again shortly|Research request limit reached|Tracking capacity reached|Invalid tracking record)$/.test(message);reply(safe?400:503,{error:safe?message:'Research temporarily unavailable; no complete assessment is claimed.'});}
  finally{apiInFlight--;}
 });
 server.requestTimeout=35000;server.headersTimeout=5000;server.maxConnections=20;
 const timer=setInterval(()=>void tracking.tick().catch(()=>console.warn('[ProjectIntelligence] Tracking cycle deferred')),60000);timer.unref();
 server.listen(Number(process.env.PORT??8080),'0.0.0.0');
 console.info('[ProjectIntelligence] Separate worker started; no alert listeners or Telegram polling');
 return async()=>{clearInterval(timer);await new Promise<void>(resolve=>server.close(()=>resolve()));await close();};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)start().catch(()=>{console.error('[ProjectIntelligence] Startup failed; validate dedicated configuration');process.exitCode=1;});
