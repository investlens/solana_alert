/**
 * AlphaOS Echo BOOST Strategy C research experiment (MARK PRICES ONLY).
 *
 * No wallet, RPC, signing, quote, Telegram, auto-trading or production hooks.
 * Assumed 1% on entry and on each sell. Values are NOT executable fills.
 *
 * Entry: $10. Initial hard stop: -15%.
 * After an observed +30%, lift stop to fee-aware gross breakeven.
 * After an observed +50%, sell 75% of initial paper token units once.
 * Trail the last 25% from subsequent observed peaks: 25% / 20% at 2x /
 * 15% at 5x. Stop executes at NEXT observed mark (gaps may worsen fills).
 * Optional end-of-window mark liquidates any outstanding amount as an
 * estimated paper close, never as actual exit liquidity proof.
 */
export const BOOST_STRATEGY_C_LIVE_TRADING_ENABLED=false as const;
export const BOOST_STRATEGY_C_PAPER_STAKE_USD=10;
const COST=0.01, STOP=0.15;
export type BoostCObservation={at:number;priceUsd:number;liquidityUsd?:number|null;pool?:string};
export type BoostCExit={kind:'INITIAL_STOP'|'PARTIAL_75'|'RUNNER_STOP'|'WINDOW_END';
 at:number;priceUsd:number;fractionOfInitial:number;estimatedProceedsUsd:number};
export type BoostCResult={
 status:'CLOSED'|'RUNNER_OPEN'|'FULL_OPEN'|'INVALID_OBSERVATIONS';
 paperOnly:true; executableVerified:false;
 initialUnits:number;remainingFraction:number;
 realizedPaperProceedsUsd:number;estimatedRealizedPnlUsd:number;
 markToMarketPnlUsd:number|null; exits:BoostCExit[];
 reason?:string
};
export function replayBoostStrategyC(input:BoostCObservation[], opts?:{
 stakeUsd?:number; entryMaxLagSeconds?:number; windowEndAt?:number
}):BoostCResult{
 const invalid=(reason:string):BoostCResult=>({
  status:'INVALID_OBSERVATIONS',paperOnly:true,executableVerified:false,
  initialUnits:0,remainingFraction:0,realizedPaperProceedsUsd:0,
  estimatedRealizedPnlUsd:0,markToMarketPnlUsd:null,exits:[],reason
 });
 const stake=opts?.stakeUsd??10;
 if(!Number.isFinite(stake)||stake!==10)return invalid('EXACT_TEN_USD_PAPER_STAKE_REQUIRED');
 if(!Array.isArray(input)||input.length===0)return invalid('NO_OBSERVATIONS');
 for(let i=0;i<input.length;i++){
  const p=input[i];
  if(!Number.isFinite(p.at)||!Number.isFinite(p.priceUsd)||p.priceUsd<=0||
     (i>0&&p.at<=input[i-1].at))return invalid('BAD_OR_UNORDERED_PRICE_SAMPLE');
  if(p.liquidityUsd!==undefined&&p.liquidityUsd!==null&&
      (!Number.isFinite(p.liquidityUsd)||p.liquidityUsd<=0))
   return invalid('INVALID_LIQUIDITY_SAMPLE');
  if(i>0&&input[0].pool&&p.pool&&p.pool!==input[0].pool)
   return invalid('POOL_SWITCH_NOT_ALLOWED');
 }
 const entry=input[0].priceUsd,entryTime=input[0].at;
 if(opts?.entryMaxLagSeconds!==undefined&&
   (!Number.isFinite(opts.entryMaxLagSeconds)||opts.entryMaxLagSeconds<0))
  return invalid('INVALID_ENTRY_AGE');
 if(opts?.windowEndAt!==undefined&&
   (!Number.isFinite(opts.windowEndAt)||opts.windowEndAt<entryTime))
  return invalid('INVALID_WINDOW_END');
 const units=stake*(1-COST)/entry;
 let remaining=1,partiallySold=false,peak=entry,stopPrice=entry*(1-STOP);
 let proceeds=0;const exits:BoostCExit[]=[];
 const sell=(kind:BoostCExit['kind'],p:BoostCObservation,fraction:number)=>{
  const take=Math.min(remaining,fraction);
  const received=units*take*p.priceUsd*(1-COST);
  exits.push({kind,at:p.at,priceUsd:p.priceUsd,
   fractionOfInitial:take,estimatedProceedsUsd:received});
  proceeds+=received;remaining=Math.max(0,remaining-take);
 };
 // Entry is the first observation. No same-tick exits.
 for(const p of input.slice(1)){
  if(opts?.windowEndAt!==undefined&&p.at>opts.windowEndAt)break;
  // Stop known from PRIOR sample is tested first. Never fill at stop
  // when the next market observation gaps below that price.
  if(p.priceUsd<=stopPrice){
   sell(partiallySold?'RUNNER_STOP':'INITIAL_STOP',p,remaining);
   break;
  }
  peak=Math.max(peak,p.priceUsd);
  const gain=peak/entry-1;
  if(!partiallySold&&gain>=0.5){
   sell('PARTIAL_75',p,0.75);
   partiallySold=true;
   // Runner starts at observed partial-exit price.
   const trail=gain>=4?0.15:gain>=1?0.20:0.25;
   stopPrice=Math.max(stopPrice,peak*(1-trail));
  }else if(partiallySold){
   const trail=gain>=4?0.15:gain>=1?0.20:0.25;
   stopPrice=Math.max(stopPrice,peak*(1-trail));
  }else if(gain>=0.3){
   // Assumed round-trip cost 1% on each leg: minimum gross breakeven
   // exit price is 1/(.99^2) times entry.
   stopPrice=Math.max(stopPrice,entry/(1-COST)**2);
  }
 }
 const last=opts?.windowEndAt===undefined?
  input[input.length-1]:
  [...input].reverse().find(p=>p.at<=opts.windowEndAt);
 if(remaining>0&&opts?.windowEndAt!==undefined&&last&&last.at>=opts.windowEndAt){
  sell('WINDOW_END',last,remaining);
 }
 return {status:remaining===0?'CLOSED':partiallySold?'RUNNER_OPEN':'FULL_OPEN',
  paperOnly:true,executableVerified:false,initialUnits:units,
  remainingFraction:remaining,realizedPaperProceedsUsd:proceeds,
  estimatedRealizedPnlUsd:proceeds-stake,
  markToMarketPnlUsd:last?proceeds+units*remaining*last.priceUsd*(1-COST)-stake:null,
  exits};
}
