/** Bounded fresh scan priority. Never reduces the normal historical RPC budget;
 * high-volume catch-up receives three extra pages only if queue pressure is low.
 * A pending frontier remains durable and never silently advances.
 */
export function echoFreshPageBudget(pending:boolean,queueSize:number):number{
  if(!Number.isSafeInteger(queueSize)||queueSize<0)throw Error('INVALID_QUEUE_SIZE');
  return pending && queueSize<16 ? 6 : 3;
}
