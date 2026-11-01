/** Pure, non-executing pacing policy for Echo's historical catch-up.
 * WebSocket notifications are the live path. The old chain checkpoint is an
 * auditable debt, never a reason to continuously poll an otherwise healthy
 * stream. A head probe is a spot check, NOT a proof of contiguous coverage.
 */
export type EchoRecoveryMode='none'|'head'|'archive';
export type EchoRecoveryReason=
  'LIVE_QUEUE_PRESSURE'|'LIVE_HEAD_SPOT_CHECK'|'ARCHIVE_AUDIT_DUE'|
  'WS_DISCONNECTED'|'WS_RECONNECTED'|'NOT_DUE';
export type EchoRecoveryDecision={mode:EchoRecoveryMode;reason:EchoRecoveryReason};
export const ECHO_HEAD_SPOTCHECK_INTERVAL_MS=15*60_000;
export const ECHO_ARCHIVE_AUDIT_INTERVAL_MS=30*60_000;
export const ECHO_DISCONNECTED_CATCHUP_INTERVAL_MS=3*60_000;
export const ECHO_RECONNECT_MIN_INTERVAL_MS=2*60_000;
export const ECHO_MAX_BACKGROUND_QUEUE=15;
type Input={
 nowMs:number;websocketReady:boolean;queueSize:number;
 /** Has archive or fresh replay work outstanding (not a sign of live failure). */
 historyPending:boolean;
 lastHeadAtMs:number|null;lastArchiveAtMs:number|null;
 /** Last incoming stream notification, separate from subscription ACK traffic. */
 lastStreamNotificationAtMs?:number|null;
 reconnectEvent?:boolean;
};
export function planEchoRecovery(input:Input):EchoRecoveryDecision{
 const {nowMs,websocketReady,queueSize,historyPending,lastHeadAtMs,lastArchiveAtMs,
   reconnectEvent=false}=input;
 const lastStreamNotificationAtMs=input.lastStreamNotificationAtMs??null;
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    !Number.isSafeInteger(queueSize)||queueSize<0||
    ![lastHeadAtMs,lastArchiveAtMs,lastStreamNotificationAtMs].every(x=>x===null||
      (Number.isSafeInteger(x)&&x>=0&&x<=nowMs)))
   throw Error('INVALID_RECOVERY_CLOCK_OR_QUEUE');
 const due=(last:number|null,period:number)=>last===null||nowMs-last>=period;
 if(queueSize>ECHO_MAX_BACKGROUND_QUEUE)
  return {mode:'none',reason:'LIVE_QUEUE_PRESSURE'};
 if(reconnectEvent&&due(lastArchiveAtMs,ECHO_RECONNECT_MIN_INTERVAL_MS))
  return {mode:'archive',reason:'WS_RECONNECTED'};
 if(!websocketReady&&due(lastArchiveAtMs,ECHO_DISCONNECTED_CATCHUP_INTERVAL_MS))
  return {mode:'archive',reason:'WS_DISCONNECTED'};
 if(websocketReady&&historyPending&&due(lastArchiveAtMs,ECHO_ARCHIVE_AUDIT_INTERVAL_MS))
  return {mode:'archive',reason:'ARCHIVE_AUDIT_DUE'};
 // A healthy active stream is sufficient for the fast path; don't spend
 // extra signature-list credits every 15 minutes merely to reconfirm traffic.
 if(websocketReady&&lastStreamNotificationAtMs!==null&&
    nowMs-lastStreamNotificationAtMs<ECHO_HEAD_SPOTCHECK_INTERVAL_MS)
  return {mode:'none',reason:'NOT_DUE'};
 if(websocketReady&&due(lastHeadAtMs,ECHO_HEAD_SPOTCHECK_INTERVAL_MS))
  return {mode:'head',reason:'LIVE_HEAD_SPOT_CHECK'};
 return {mode:'none',reason:'NOT_DUE'};
}

/** Return the least-recently active wallet, not the most recently active
 * subscription. Another caller's traffic cannot mask a silent wallet.
 * On a new connection, allow the subscription its normal quiet interval
 * before checking; an ACK is not itself a transaction notification.
 */
export function echoWalletStreamLastSeen(
  wallet:string,notifications:Readonly<Record<string,number>>,
  connectedAtMs:number|null
):number|null {
 if(!wallet||connectedAtMs!==null&&(!Number.isSafeInteger(connectedAtMs)||connectedAtMs<0))
  throw Error('INVALID_WALLET_ACTIVITY');
 const seen=notifications[wallet]??null;
 if(seen!==null&&(!Number.isSafeInteger(seen)||seen<0))
  throw Error('INVALID_WALLET_ACTIVITY');
 return connectedAtMs===null?seen:Math.max(connectedAtMs,seen??0);
}
export function oldestEchoWalletStreamSeen(
  wallets:readonly string[],notifications:Readonly<Record<string,number>>,
  connectedAtMs:number|null
):number|null {
 if(!wallets.length||new Set(wallets).size!==wallets.length)
  throw Error('INVALID_WALLET_SET');
 const seen=wallets.map(wallet=>echoWalletStreamLastSeen(wallet,notifications,connectedAtMs));
 return seen.some(v=>v===null)?null:Math.min(...seen as number[]);
}
export function shouldEchoSpotcheckWallet(input:{
 nowMs:number;wallet:string;notifications:Readonly<Record<string,number>>;
 connectedAtMs:number|null
}):boolean {
 const last=echoWalletStreamLastSeen(input.wallet,input.notifications,input.connectedAtMs);
 if(!Number.isSafeInteger(input.nowMs)||input.nowMs<=0||
    last!==null&&input.nowMs<last)throw Error('INVALID_WALLET_ACTIVITY_TIME');
 return last===null||input.nowMs-last>=ECHO_HEAD_SPOTCHECK_INTERVAL_MS;
}
