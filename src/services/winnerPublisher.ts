import { runnerCrossings, type RunnerSample } from './compactRunnerMilestones.js';
import type { CompactTrackingRow } from './compactAlertOutcomes.js';
import { claimSharedDelivery } from './sharedJsonCache.js';
// Independent opt-in publisher. No Telegram dependencies or alert retries.
export function winnerPost(row: CompactTrackingRow, sample: RunnerSample, baseUrl: string): {key:string;text:string}|null {
 const crossings=runnerCrossings(row,sample); if(!crossings.length) return null;
 const url=new URL('/performance',baseUrl); if(url.protocol!=='https:')return null;
 url.hash=row.token;
 const multiple=crossings[crossings.length-1];
 const symbol=(sample.symbol??row.token.slice(0,8)).replace(/[^a-zA-Z0-9_]/g,'').slice(0,16);
 return {key:`alphaos:x:winner:${row.chain}:${row.token.toLowerCase()}:${row.started_at}:${multiple}`,
 text:`AlphaOS | $${symbol} reached ${multiple}x
${row.chain}
Alert baseline: ${new Date(row.started_at).toISOString().slice(0,16)} UTC
CA: ${row.token}
Sampled move, not profit. Excludes fees/slippage.
${url}`};
}
export async function publishWinner(row:CompactTrackingRow,sample:RunnerSample):Promise<void> {
 if(process.env.ALPHA_X_PUBLISH_ENABLED!=='true')return;
 const token=process.env.ALPHA_X_USER_ACCESS_TOKEN,account=process.env.ALPHA_X_ACCOUNT_ID,base=process.env.ALPHA_PUBLIC_URL;
 if(!token||!account||!base)return;
 const post=winnerPost(row,sample,base);if(!post)return;
 // Confirm user-context credentials belong to the configured account before claiming/sending.
 const me=await fetch('https://api.x.com/2/users/me',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
 if(!me.ok || (await me.json() as {data?:{id?:string}}).data?.id!==account)throw Error('X account verification failed');
 if(await claimSharedDelivery(post.key,30*24*60*60_000)!=='CLAIMED')return;
 // Ambiguous responses are never replayed automatically, avoiding duplicate public posts.
 const response=await fetch('https://api.x.com/2/tweets',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({text:post.text}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error(`X publication unconfirmed: HTTP ${response.status}`);
 console.log('[WinnerPublisher] POST_ACCEPTED');
}
