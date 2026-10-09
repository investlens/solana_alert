import type {CompactTrackingRow,CompactSample} from './compactAlertOutcomes.js';
import {escapeTelegramHtml as esc} from '../ui/escapeHtml.js';
import {claimSharedDelivery} from './sharedJsonCache.js';
import {getDeliverableUsers} from '../core/delivery.js';
import {enabledLiveRecipients, type LiveFeedKey} from './liveAlertPreferences.js';
import {buildAlphaosAlertCard} from '../ui/alphaosAlertCard.js';
import {sendAlphaosPhotoAlert} from '../ui/alphaosPhotoDelivery.js';
import {waitForRecipientDelivery,recordDeliveryAccepted} from './recipientDeliveryTiming.js';
import {withResearchDisclosure} from '../ui/researchDisclosure.js';
export const RUNNER_MULTIPLES=[2,5,10,50,100] as const;
export type RunnerSample=CompactSample & {name?:string;symbol?:string};
export function runnerSourceFeed(chain:string,feed:string):LiveFeedKey|null {
 if(chain==='arc')return /DEX_PAID/.test(feed)?'ARC_DEX_PAID':/BOOST/.test(feed)?'ARC_BOOST':/BURN/.test(feed)?'ARC_SUPPLY_BURN':feed==='ARC_OPPORTUNITY'?'ARC_OPPORTUNITY':null;
 if(chain!=='robinhood')return null;
 if(/DEX_PAID/.test(feed))return 'DEX_PAID';if(/BOOST/.test(feed))return 'RH_BOOST';
 if(/SOCIAL_MAFIA/.test(feed))return 'RH_SOCIAL_MAFIA';if(/PROTOCOL/.test(feed))return 'RH_PROTOCOL_DISCOVERY';
 if(/BURN/.test(feed))return 'RH_SUPPLY_BURN';if(/SETUP|VOLUME_BREAKOUT/.test(feed))return 'RH_TRADE_SETUP';
 if(/MOMENTUM|IGNITION|RECOVERY|PONS_NORMAL/.test(feed))return 'RH_MOMENTUM';return null;
}
export function runnerCrossings(row:CompactTrackingRow,sample:RunnerSample):number[]{
 const started=Date.parse(row.started_at),observed=Date.parse(sample.at);
 if(!runnerSourceFeed(row.chain,row.feed)||row.price_unit!=='USD'||sample.status!=='MEASURED'
  ||!/^0x[a-f0-9]{40}$/i.test(row.token)||!/^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(row.pair_id)
  ||!Number.isFinite(started)||!Number.isFinite(observed)||observed<=started||observed-started>365*60_000
  ||typeof row.baseline_price!=='number'||!Number.isFinite(row.baseline_price)||row.baseline_price<=0
  ||typeof sample.price!=='number'||!Number.isFinite(sample.price)||sample.price<=0)return [];
 return RUNNER_MULTIPLES.filter(m=>sample.price!>=row.baseline_price*m);
}
const price=(n:number)=>`$${n>=1?n.toLocaleString('en-US',{maximumFractionDigits:6}):n.toPrecision(6)}`;
const money=(n:number)=>n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${n.toFixed(2)}`;
const at=(v:string)=>new Date(v).toISOString().replace('T',' ').slice(0,19)+' UTC';
export function renderCompactRunner(row:CompactTrackingRow,sample:RunnerSample,multiple:number):string {
 if(!runnerCrossings(row,sample).includes(multiple))throw Error('Unverified runner milestone');
 const actual=sample.price!/row.baseline_price;
 const peakPrice = Math.max(row.baseline_price, sample.price!, ...(row.samples ?? [])
  .filter(s => s.status === 'MEASURED' && typeof s.price === 'number' && Number.isFinite(s.price) && s.price > 0
   && Date.parse(s.at) > Date.parse(row.started_at) && Date.parse(s.at) <= Date.parse(sample.at))
  .map(s => s.price!));
 const label=multiple===100?'💎 LEGENDARY RUNNER':multiple===50?'🏆 ULTRA RUNNER':multiple===10?'🏆 MEGA RUNNER':multiple===5?'🔥 STRONG RUNNER':'🚀 RUNNER';
 const identity=sample.name?esc(sample.name.slice(0,48)):esc(row.token.slice(0,8)+'…'+row.token.slice(-4));
 const thin=sample.liquidity==null||!Number.isFinite(sample.liquidity)||sample.liquidity<2_000;
 return withResearchDisclosure([
  `<b>${label} · ${multiple}× SINCE ALERT</b>`,`${identity}${sample.symbol?' ($'+esc(sample.symbol.slice(0,20))+')':''}`,
  `${row.chain==='arc'?'ARC':'Robinchain'} · ${esc(row.feed.replace(/_/g,' '))}`,'',
  ...(sample.mc!=null&&Number.isFinite(sample.mc)&&sample.mc>0?[`Market cap <b>${money(sample.mc)}</b>`]:[]),
  `Alert price <b>${price(row.baseline_price)}</b>`,`Observed price <b>${price(sample.price!)}</b>`,
  `Highest sampled price <b>${price(peakPrice)}</b> · <b>${(peakPrice/row.baseline_price).toFixed(2)}×</b>`,
  `Latest multiple <b>${actual.toFixed(2)}×</b> · <b>+${((actual-1)*100).toFixed(1)}%</b>`,
  ...(sample.liquidity!=null&&Number.isFinite(sample.liquidity)&&sample.liquidity>=0?[`Liquidity <b>${money(sample.liquidity)}</b>`]:[]),
  '',`Alert baseline ${at(row.started_at)}`,`Observed ${at(sample.at)}`,
  ...(thin?['⚠️ Liquidity is thin or unconfirmed; quoted gains may not be executable.']:[]),
  'Sampled gross price move, not realised profit. Fees and slippage excluded.',
  'Checkpoint coverage · not lifetime ATH. Do not chase past performance.',
  '',`<code>${esc(row.token)}</code>`,
 ].join('\n'));
}
export function compactRunnerButtons(row:CompactTrackingRow){
 return [[{text:'📊 Chart',url:`https://dexscreener.com/${row.chain}/${row.pair_id}`}],
  [{text:'🔎 Explorer',url:`https://${row.chain==='arc'?'explorer.arc.io':'robinhoodchain.blockscout.com'}/token/${row.token}`},
   {text:'📋 Copy CA',callback_data:`COPY_CA_${row.token}`}],
  [{text:'🔔 Open AlphaOS',url:'https://t.me/AlphaOSResearchBot'}]];
}
type Dependencies={claim:typeof claimSharedDelivery;deliver:(row:CompactTrackingRow,sample:RunnerSample,multiple:number)=>Promise<void>};
async function deliver(row:CompactTrackingRow,sample:RunnerSample,multiple:number){
 const botToken=process.env.TELEGRAM_BOT_TOKEN?.trim();if(!botToken)throw Error('Runner delivery unavailable');
 const users=await getDeliverableUsers();const targets=new Set(users.filter(u=>!u.is_blocked).map(u=>String(u.telegram_id)));
 const admin=String(process.env.ADMIN_TELEGRAM_ID??process.env.OWNER_CHAT_ID??'').trim();if(admin)targets.add(admin);
 const recipients=await enabledLiveRecipients([...targets],runnerSourceFeed(row.chain,row.feed)!);
 if(!recipients.length)return;
 const image=await buildAlphaosAlertCard({symbol:sample.symbol,name:sample.name,category:`${multiple}X RUNNER`,chainLabel:row.chain==='arc'?'ARC':'ROBINCHAIN',badge:`${multiple}X SINCE ALERT`,footer:'Sampled price move. Not trade profit or a buy signal.'}).catch(()=>null);
 const text=renderCompactRunner(row,sample,multiple),started=Date.now();
 // Sequential fan-out keeps Telegram concurrency bounded. No ambiguous-send retries.
 let accepted=0;
 for(const chatId of recipients){try{
  await waitForRecipientDelivery(chatId,started);
  await sendAlphaosPhotoAlert({botToken,chatId,text,keyboard:compactRunnerButtons(row),image});
  recordDeliveryAccepted(chatId,started,`runner:${row.chain}:${row.token}:${multiple}`);accepted++;
 }catch{console.warn('[RunnerCard] recipient delivery unconfirmed');}}
 console.log('[RunnerCard] DELIVERY',{chain:row.chain,multiple,accepted,failed:recipients.length-accepted});
}
const production:Dependencies={claim:claimSharedDelivery,deliver};
let activeDeliveries=0;
export async function processCompactRunner(row:CompactTrackingRow,sample:RunnerSample,deps=production):Promise<void>{
 if(deps===production && activeDeliveries>=2)return;
 const crossings=runnerCrossings(row,sample);if(!crossings.length)return;
 if(deps===production)activeDeliveries++;
 try{
 const highest=crossings[crossings.length-1];const prefix=`alphaos:runner:${row.chain}:${row.token.toLowerCase()}:${row.started_at}`;
 // Claim the highest observed milestone first; a gap directly to 10x emits one
 // card and silently consumes lower milestones. Claims survive worker restarts.
 if(await deps.claim(`${prefix}:${highest}`,7*24*60*60_000)!=='CLAIMED')return;
 for(const lower of crossings.slice(0,-1))if(await deps.claim(`${prefix}:${lower}`,7*24*60*60_000)==='UNAVAILABLE')return;
 await deps.deliver(row,sample,highest);
 }finally{if(deps===production)activeDeliveries--;}
}
