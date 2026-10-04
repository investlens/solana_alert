import { recentDexPayment } from '../dexPaidWatchState.js';
import { getPonsLaunchState } from '../ponsLaunchState.js';
import { routeBoostSecurity, type BoostSecurityGateDecision } from '../boostSecurityRouter.js';
import { scanRobinhoodDexPaid, type RobinhoodDexPaidResult } from './dexPaidScanner.js';
type GateCheck = {key:string;passed:boolean;detail:string};
export type DexPaidAlertSafetyResult = {
  allowed:boolean;reasons:string[];checks:GateCheck[];
  marketCapUsd:number|null;liquidityUsd:number|null;pairAgeMinutes:number|null;
  paymentAgeSeconds:number|null;sellImpactPercent:number|null;ponsDeployer:string|null;
  devHoldingPercent?:number|null;top10Percent?:number|null;
  launchType?:'PONS'|'CUSTOM'|'UNKNOWN';securityNote?:string;
};
type Dependencies = {
  paid:(token:string)=>Promise<RobinhoodDexPaidResult>;
  launch:(token:string)=>Promise<{exists:boolean;token:string;deployer:string}|null>;
  custom:(token:string)=>Promise<BoostSecurityGateDecision>;
  now:()=>number;
};
export function createDexPaidEventGate(deps:Dependencies) {
  return async(token:string):Promise<DexPaidAlertSafetyResult>=>{
    const base:DexPaidAlertSafetyResult={allowed:false,reasons:[],checks:[],marketCapUsd:null,liquidityUsd:null,
      pairAgeMinutes:null,paymentAgeSeconds:null,sellImpactPercent:null,ponsDeployer:null};
    try {
      const paid=await deps.paid(token);
      const confirmed=paid.dexPaid===true&&paid.status==='PAID';
      base.checks.push({key:'DEX_PAID_CONFIRMED',passed:confirmed,detail:paid.status});
      if(!confirmed){base.reasons.push('DEX_PAID_UNCONFIRMED');return base;}
      const fresh=recentDexPayment(paid.latestPaymentTimestamp,deps.now());
      const at=paid.latestPaymentTimestamp;
      base.paymentAgeSeconds=at==null?null:Math.max(0,(deps.now()-(at<10_000_000_000?at*1000:at))/1000);
      base.checks.push({key:'PAYMENT_FRESHNESS',passed:fresh,detail:'New payment event window; token age has no limit'});
      if(!fresh){base.reasons.push('PAYMENT_OUTSIDE_WINDOW');return base;}
      const launch=await deps.launch(token).catch(()=>null);
      if(launch?.exists&&launch.token.toLowerCase()===token.toLowerCase()) {
        base.allowed=true;base.launchType='PONS';base.ponsDeployer=launch.deployer;
        base.securityNote='Verified PONS launchpad origin · payment is promotion, not a trade recommendation.';
        base.checks.push({key:'TRUSTED_LAUNCHPAD',passed:true,detail:'Authoritative PONS factory verification'});
        return base;
      }
      const custom=await deps.custom(token);
      base.allowed=custom.allowed;base.launchType=launch?'CUSTOM':'UNKNOWN';
      base.checks.push({key:'CUSTOM_SELLABILITY',passed:custom.allowed,detail:custom.reason});
      if(!custom.allowed)base.reasons.push(custom.reason);
      base.securityNote=custom.liquidity?.status==='UNLOCKED'
        ? '⚠️ LP unlocked · liquidity can be removed. Honeypot/sell-restriction checks passed.'
        : custom.liquidity?.status === 'UNKNOWN' ? 'Sellability checks passed · LP protection unverified; validate before investing.' : 'Honeypot/sell-restriction checks passed · payment does not establish trading quality.';
      return base;
    }catch(error){base.reasons.push(`EVENT_GATE_UNAVAILABLE: ${error instanceof Error?error.message:String(error)}`);return base;}
  };
}
// No market-cap, token-age, volume, dev-holding or bundle entry thresholds.
// No per-check SQL security snapshots. Ownership is disclosed by the shared bounded renderer.
export const evaluateDexPaidAlertSafety=createDexPaidEventGate({paid:scanRobinhoodDexPaid,
  launch:token=>getPonsLaunchState(token,{requireCompleteFactoryVerification:true}),
  custom:token=>routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:false,requireExplicitSellability:true}),now:Date.now});
