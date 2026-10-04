import { scanRobinhoodBundleIntelligence, type RobinhoodBundleIntelligenceResult } from '../chains/robinhood/security/bundleIntelligence.js';
import { escapeTelegramHtml as esc } from '../ui/escapeHtml.js';
const cache = new Map<string, { at: number; value: RobinhoodBundleIntelligenceResult }>();
const pending = new Map<string, Promise<RobinhoodBundleIntelligenceResult>>();
let minute = 0, starts = 0;
export async function getWalletLinkResearch(token: string): Promise<RobinhoodBundleIntelligenceResult> {
  if (!/^0x[a-f0-9]{40}$/i.test(token)) throw Error('Invalid Robinchain token');
  token = token.toLowerCase();
  const saved = cache.get(token); if (saved && Date.now()-saved.at < 30_000) return saved.value;
  if (pending.has(token)) return withDeadline(pending.get(token)!);
  const window = Math.floor(Date.now()/60_000); if (window !== minute) { minute=window; starts=0; }
  if (pending.size >= 2 || starts >= 6) throw Error('Wallet-link research budget reached');
  starts++;
  const work = scanRobinhoodBundleIntelligence(token).then(value => {
    if (cache.size >= 50) cache.delete(cache.keys().next().value!); cache.set(token,{at:Date.now(),value}); return value;
  }).finally(() => pending.delete(token));
  pending.set(token, work);
  return withDeadline(work);
}
async function withDeadline(work:Promise<RobinhoodBundleIntelligenceResult>) {
  let timer:ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Wallet-link deadline reached')),6_000);})]); }
  finally {if(timer)clearTimeout(timer);}
}

export function renderWalletLinkResearch(result: RobinhoodBundleIntelligenceResult): string {
  const lines = ['🔗 <b>WALLET LINKS · ROBINCHAIN</b>', `<code>${esc(result.tokenAddress)}</code>`, ''];
  if (!result.evidenceAvailable) return [...lines, 'Transfer/holder evidence unavailable.',
    'This is not evidence of independent wallets or low risk.', ...result.reasons.slice(0,2).map(esc)].join('\n');
  const m = result.metrics;
  return [...lines, '<b>OBSERVED TRANSFER RELATIONSHIPS</b>',
    `Developer transfer destinations ${m.devSpreadDestinationCount}`,
    `Recipients in holder sample ${m.devDestinationsStillTopHolders}`,
    `Recipients currently hold <b>${m.connectedCurrentSupplyPct.toFixed(2)}% of total supply</b>`,
    `Holder sample ${m.sampledHolderCount} · Top 20 non-contract holders from available indexer page`, '',
    ...result.reasons.slice(0,4).map(reason => `• ${esc(reason)}`),
    ...(result.connectedWallets.length ? ['', '<b>SAMPLED RECIPIENTS</b>', ...result.connectedWallets.slice(0,4).map(wallet =>
      `<a href="https://robinhoodchain.blockscout.com/address/${esc(wallet)}">${esc(wallet.slice(0,8)+'…'+wallet.slice(-4))}</a>`)] : []), '',
    'Direct token transfers show a relationship, not common ownership or a confirmed sale.',
    'Similar balances alone do not establish connected wallets. Funding clusters and complete history are not verified.',
    `Observed ${new Date(result.scannedAt).toISOString().slice(11,19)} UTC · Indexer / on-chain transfer evidence`,
    '<i>On-demand research · No trading approval</i>',
  ].join('\n');
}
