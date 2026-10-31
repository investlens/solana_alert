/** Bounded fresh scan priority. Never reduces the normal historical RPC budget;
 * high-volume catch-up receives three extra pages only if queue pressure is low.
 * A pending frontier remains durable and never silently advances.
 */
export function echoFreshPageBudget(pending:boolean,queueSize:number):number{
  if(!Number.isSafeInteger(queueSize)||queueSize<0)throw Error('INVALID_QUEUE_SIZE');
  return pending && queueSize<16 ? 6 : 3;
}

/** Use Solana's supported 1000-signature page only for the high-volume watched
 * wallet and only when queue pressure is low. Larger pages reduce pagination
 * RPC round trips; they do not increase transaction-fetch concurrency.
 * At elevated queue pressure revert to 100 signatures and one page.
 */
export function echoFreshScanPlan(isSlingoor:boolean,pending:boolean,queueSize:number):
  {pageLimit:number,maxPages:number}{
  if(!Number.isSafeInteger(queueSize)||queueSize<0)throw Error('INVALID_QUEUE_SIZE');
  if(!isSlingoor)return {pageLimit:100,maxPages:echoFreshPageBudget(pending,queueSize)};
  if(queueSize>=16)return {pageLimit:100,maxPages:1};
  if(pending)return {pageLimit:1000,maxPages:2};
  return {pageLimit:100,maxPages:3};
}
