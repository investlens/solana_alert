/** Single source of truth for vetted Echo caller identities.
 * Add new verified wallets here; monitoring and trade permissions are independent.
 * This module contains NO runtime permission to turn on real execution.
 */
import { PublicKey } from '@solana/web3.js';

export type EchoCaller = Readonly<{
 id: string;
 displayName: string;
 wallet: string;
 monitor: boolean;
 alert: boolean;
 paperTrade: boolean;
 manualBuyEligible: boolean;
 autoBuyEligible: boolean;
 priority: number;
}>;

const configuredCallers: readonly EchoCaller[] = [
 { id:'slingoor', displayName:'Slingoor',wallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',monitor:true,alert:true,paperTrade:true,manualBuyEligible:true,autoBuyEligible:false,priority:100 },
 { id:'chairman', displayName:'Chairman',wallet:'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6',monitor:true,alert:true,paperTrade:true,manualBuyEligible:false,autoBuyEligible:false,priority:80 },
];

export function validateEchoCallers(callers: readonly EchoCaller[]): void {
 const ids = new Set<string>(); const wallets = new Set<string>();
 for (const c of callers) {
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(c.id) || ids.has(c.id)) throw Error('ECHO_CALLER_INVALID_OR_DUPLICATE_ID');
  let wallet: string;
  try { wallet = new PublicKey(c.wallet).toBase58(); }
  catch { throw Error('ECHO_CALLER_INVALID_WALLET'); }
  if (wallet !== c.wallet || wallets.has(wallet)) throw Error('ECHO_CALLER_DUPLICATE_WALLET');
  if (!Number.isSafeInteger(c.priority) || c.priority < 0 || c.priority > 1000)
   throw Error('ECHO_CALLER_INVALID_PRIORITY');
  if ((c.alert || c.paperTrade || c.manualBuyEligible || c.autoBuyEligible) && !c.monitor)
   throw Error('ECHO_CALLER_REQUIRES_MONITORING');
  if (c.autoBuyEligible) throw Error('ECHO_AUTO_BUY_REQUIRES_SEPARATE_APPROVAL');
  ids.add(c.id); wallets.add(wallet);
 }
}
validateEchoCallers(configuredCallers);
export const ECHO_CALLERS: readonly EchoCaller[] = Object.freeze(configuredCallers.map(c=>Object.freeze({...c})));
export const ECHO_MONITORED_CALLERS = ECHO_CALLERS.filter(c=>c.monitor).sort((a,b)=>b.priority-a.priority);
export const ECHO_ALERT_CALLER_WALLETS: ReadonlySet<string> = new Set(ECHO_CALLERS.filter(c=>c.alert).map(c=>c.wallet));
export const ECHO_MANUAL_BUY_CALLER_WALLETS: ReadonlySet<string> = new Set(ECHO_CALLERS.filter(c=>c.manualBuyEligible).map(c=>c.wallet));
export const ECHO_SHADOW_CALLER_WALLETS: ReadonlySet<string> = new Set(ECHO_CALLERS.filter(c=>c.paperTrade).map(c=>c.wallet));
export function echoCallerByWallet(wallet: string): EchoCaller | undefined { return ECHO_CALLERS.find(c=>c.wallet===wallet); }
