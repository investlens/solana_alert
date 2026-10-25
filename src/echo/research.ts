import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openPaperStop, updatePaperStop, type PaperStop } from './signals.js';

type Sample = { at: number; usd: number; liquidityUsd: number | null; pool: string };
type Trial = {
  id: string; caller: string; mint: string; signature: string; deliveryAt: number;
  entry: number | null; entryAt: number | null; pool: string | null;
  stop: PaperStop | null; exitAt: number | null; exitPrice: number | null;
  peak: number | null; points: Sample[]; checkpoints: Record<string, number | null>;
  milestones?: Record<string, number>;
  status: 'AWAITING_PRICE' | 'TRACKING' | 'EXIT_OBSERVED' | 'CENSORED' | 'COMPLETE';
};
type PaperEvent={id:string;kind:'ENTRY'|'EXIT'|'MILESTONE';mint:string;caller:string;entry:number;price:number;multiple?:number;roiPercent:number;paperUsd:number;quantity:number;exitValueUsd:number;netPnlUsd:number;costBpsPerSide:number};
type State = { version: 1; trials: Trial[]; pending?:PaperEvent[] };
const windows = [300, 900, 1800, 3600, 21600, 86400] as const;
const horizon = 86400;
const PAPER_USD=10;
// Conservative illustration only; not measured actual routing costs.
const SIMULATED_COST_BPS_PER_SIDE=100;
const paperQuantity=(entry:number)=>PAPER_USD*(1-SIMULATED_COST_BPS_PER_SIDE/10000)/entry;
const paperExitValue=(entry:number,price:number)=>paperQuantity(entry)*price*(1-SIMULATED_COST_BPS_PER_SIDE/10000);
const multiples = [2,5,10,50,100] as const;
const clamp = (x: number) => Math.round(x * 10000) / 100;
const validMint = (mint: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint);
/** Research-only, minute-resolution MARK-price observations, not executable fill quotes. */
export class EchoResearch {
  private trials: Trial[] = [];
  private pending:PaperEvent[]=[]; private lastNotified:number|null=null; private notificationErrors=0;
  private working = false;
  private writes = Promise.resolve();
  private nextTick = 0;
  private lastError: string | null = null;
  private readonly maxActive = 64;
  constructor(private readonly path: string, private readonly notify?: (event:{kind:'ENTRY'|'EXIT'|'MILESTONE';mint:string;caller:string;entry:number;price:number;multiple?:number;roiPercent:number})=>Promise<void>) {}
  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path,'utf8')) as State;
      if (parsed.version !== 1 || !Array.isArray(parsed.trials)) throw new Error('Invalid research state');
      this.trials = parsed.trials;
      this.pending=Array.isArray(parsed.pending)?parsed.pending.slice(-250):[];
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  private persist() {
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path),{recursive:true,mode:0o700});
      const tmp = this.path+'.tmp';
      await writeFile(tmp,JSON.stringify({version:1,trials:this.trials,pending:this.pending} satisfies State),{mode:0o600});
      await rename(tmp,this.path);
    });
    return this.writes;
  }
  async addBuy(ev: { caller:string; mint:string; signature:string; deliveryAt:number }) {
    if (!validMint(ev.mint) || !Number.isFinite(ev.deliveryAt)) return;
    const id = ev.signature+':'+ev.mint+':'+ev.caller;
    if (this.trials.some(t=>t.id===id)) return;
    const active = this.trials.filter(t=>(t.status==='TRACKING'||t.status==='AWAITING_PRICE'||t.status==='EXIT_OBSERVED') && Math.abs(ev.deliveryAt-t.deliveryAt)<86400);
    if (active.length >= this.maxActive) {
      // Preserve the opportunity and explicitly mark lack of price coverage.
      this.trials.push({id,...ev,entry:null,entryAt:null,pool:null,stop:null,exitAt:null,exitPrice:null,peak:null,
        points:[],checkpoints:{},milestones:{},status:'CENSORED'});
      await this.persist();
      console.warn('[EchoResearch] CAP_REACHED_UNPRICED',JSON.stringify({id,maxActive:this.maxActive}));
      return;
    }
    this.trials.push({id,...ev,entry:null,entryAt:null,pool:null,stop:null,exitAt:null,exitPrice:null,peak:null,
      points:[],checkpoints:{},milestones:{},status:'AWAITING_PRICE'});
    await this.persist();
    console.log('[EchoResearch] BUY_RECORDED',JSON.stringify({id}));
  }
  private enqueue(t:Trial,kind:PaperEvent['kind'],price:number,multiple?:number){
    if(t.entry===null)return;
    const id=t.id+':'+kind+':'+(multiple??'');
    if(this.pending.some(e=>e.id===id))return;
    const quantity=paperQuantity(t.entry),exitValueUsd=paperExitValue(t.entry,price);
    this.pending.push({id,kind,mint:t.mint,caller:t.caller,entry:t.entry,price,multiple,roiPercent:(price/t.entry-1)*100,
      paperUsd:PAPER_USD,quantity,exitValueUsd,netPnlUsd:exitValueUsd-PAPER_USD,costBpsPerSide:SIMULATED_COST_BPS_PER_SIDE});
    if(this.pending.length>250){this.pending.shift();console.warn('[EchoResearch] OUTBOX_LIMIT_REACHED');}
  }
  private async flush(){if(!this.notify)return;
    for(const event of [...this.pending].slice(0,10)){
      try{await this.notify(event);this.pending=this.pending.filter(e=>e.id!==event.id);
        await this.persist();this.lastNotified=Date.now();}
      catch{this.notificationErrors++;console.warn('[EchoResearch] NOTIFICATION_RETRY_PENDING',{kind:event.kind});break;}
    }
  }
  async tick() {
    if (this.working || Date.now()<this.nextTick) return;
    this.working=true; this.nextTick=Date.now()+60_000;
    try {
      const now=Date.now()/1000;
      const active=this.trials.filter(t=>(t.status==='TRACKING'||t.status==='AWAITING_PRICE'||t.status==='EXIT_OBSERVED') && now-t.deliveryAt<horizon+300);
      const mints=[...new Set(active.map(t=>t.mint))].slice(0,this.maxActive);
      for (const mint of mints) {
        const matching=active.filter(t=>t.mint===mint);
        try {
          const res=await fetch('https://api.dexscreener.com/latest/dex/tokens/'+mint,{signal:AbortSignal.timeout(3500)});
          if (!res.ok) { this.lastError='HTTP '+res.status; continue; }
          const data=await res.json();
          const pools=(Array.isArray(data.pairs)?data.pairs:[]).filter((p:any)=>
            p?.chainId==='solana' && p?.baseToken?.address===mint &&
            Number(p?.priceUsd)>0 && Number(p?.liquidity?.usd)>0);
          pools.sort((a:any,b:any)=>Number(b.liquidity.usd)-Number(a.liquidity.usd));
          for (const t of matching) {
            if (now-t.deliveryAt>horizon+300) { t.status='CENSORED'; continue; }
            // Pin initial pool for stable like-for-like pricing; never switch pools mid-trade.
            const p=t.pool ? pools.find((v:any)=>v.pairAddress===t.pool) : pools[0];
            if (!p) continue;
            const usd=Number(p.priceUsd), liq=Number(p.liquidity.usd);
            const sample:Sample={at:now,usd,liquidityUsd:liq,pool:p.pairAddress};
            if (t.entry===null) {
              if (now-t.deliveryAt>180) { t.status='CENSORED'; console.warn('[EchoResearch] ENTRY_UNAVAILABLE',JSON.stringify({id:t.id,delaySeconds:Math.round(now-t.deliveryAt)})); continue; }
              t.entry=usd;t.entryAt=now;t.pool=p.pairAddress;t.stop=openPaperStop(usd);t.peak=usd;
              this.enqueue(t,'ENTRY',usd);
            }
            t.points.push(sample);
            if (t.points.length>1500) t.points.shift();
            t.peak=Math.max(t.peak||usd,usd);
            t.milestones ??= {};
            for (const multiple of multiples) if (usd >= t.entry! * multiple && !t.milestones[String(multiple)]) {
              t.milestones[String(multiple)] = now;
              console.log('[EchoResearch] MILESTONE',JSON.stringify({id:t.id,caller:t.caller,mint:t.mint,multiple,at:now,markPriceOnly:true}));
              this.enqueue(t,'MILESTONE',usd,multiple);
            }
            if (t.stop && t.exitAt===null) {
              const next=updatePaperStop(t.stop,usd);
              if (next.closed) {t.exitAt=now;t.exitPrice=usd;t.status='EXIT_OBSERVED';
                this.enqueue(t,'EXIT',usd);}
              else {t.stop=next;t.status='TRACKING';}
            }
            for (const seconds of windows) {
              const key=String(seconds);
              if (!(key in t.checkpoints) && now-t.deliveryAt >= seconds) {
                // A late observation must not be presented as the requested checkpoint.
                t.checkpoints[key]=now-t.deliveryAt<=seconds+90 ? clamp(usd/t.entry!-1) : null;
              }
            }
            // Keep collecting checkpoints until the 24h horizon; finalize outside the fetch loop.
          }
        } catch {this.lastError='PRICE_SOURCE_UNAVAILABLE';}
      }
      for (const t of this.trials) {
        if (now-t.deliveryAt>=horizon+300 && (t.status==='AWAITING_PRICE'||t.status==='TRACKING'||t.status==='EXIT_OBSERVED')) {
          t.status=t.entry===null?'CENSORED':'COMPLETE';
          console.log('[EchoResearch] OUTCOME',JSON.stringify({id:t.id,caller:t.caller,mint:t.mint,
            deliveryAt:t.deliveryAt,entryAt:t.entryAt,entry:t.entry,exitAt:t.exitAt,exitPrice:t.exitPrice,
            peak:t.peak,milestones:t.milestones??{},checkpoints:t.checkpoints,samples:t.points.length,markPriceOnly:true}));
        }
      }
      // Keep completed outcomes 30 days. Never classify missing prices as losses.
      this.trials=this.trials.filter(t=>now-t.deliveryAt<30*86400);
      await this.persist();
      await this.flush();
    } finally {this.working=false;}
  }
  summary() {
    const counts:Record<string,number>={};
    for (const t of this.trials) counts[t.status]=(counts[t.status]||0)+1;
    const exits=this.trials.filter(t=>t.exitAt!==null&&t.entry!==null&&t.exitPrice!==null);
    const totalPnl=exits.reduce((sum,t)=>sum+paperExitValue(t.entry!,t.exitPrice!)-PAPER_USD,0);
    return {paperUsd:PAPER_USD,estimatedCostBpsPerSide:SIMULATED_COST_BPS_PER_SIDE,closedExits:exits.length,
      closedNetPnlUsd:Math.round(totalPnl*100)/100,total:this.trials.length,counts,active:this.trials.filter(t=>(t.status==='TRACKING'||t.status==='AWAITING_PRICE'||t.status==='EXIT_OBSERVED') && Date.now()/1000-t.deliveryAt<horizon).length,
      lastError:this.lastError,pendingNotifications:this.pending.length,lastNotified:this.lastNotified,notificationErrors:this.notificationErrors,milestones:Object.fromEntries(multiples.map(n=>[String(n),this.trials.filter(t=>!!t.milestones?.[String(n)]).length])),liveTrading:false,markPriceOnly:true};
  }
}