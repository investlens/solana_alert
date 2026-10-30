/** Pure trade state machine. No signing, RPC, or broadcast. */
export type EchoTradeState = 'reserved'|'signed'|'submitted'|'confirmed'|'failed_preflight'|'unknown'|'expired_unresolved';
export type EchoTradeEvent = 'PREFLIGHT_FAILED'|'SIGNED_DURABLY'|'SUBMITTED'|'CONFIRMED_ON_CHAIN'|'OUTCOME_UNKNOWN'|'EXPIRED_UNRESOLVED';
export type EchoTradeTransition = { allowed:true; next:EchoTradeState } | { allowed:false; reason:string };
const transitions: Record<EchoTradeState, Partial<Record<EchoTradeEvent,EchoTradeState>>> = {
 reserved:{PREFLIGHT_FAILED:'failed_preflight',SIGNED_DURABLY:'signed'},
 signed:{SUBMITTED:'submitted',OUTCOME_UNKNOWN:'unknown'},
 submitted:{CONFIRMED_ON_CHAIN:'confirmed',OUTCOME_UNKNOWN:'unknown',EXPIRED_UNRESOLVED:'expired_unresolved'},
 unknown:{CONFIRMED_ON_CHAIN:'confirmed',EXPIRED_UNRESOLVED:'expired_unresolved'},
 confirmed:{},failed_preflight:{},expired_unresolved:{}
};
export function transitionEchoTrade(state:EchoTradeState,event:EchoTradeEvent):EchoTradeTransition {
 const next=transitions[state]?.[event];
 return next ? {allowed:true,next} : {allowed:false,reason:'INVALID_OR_UNSAFE_TRANSITION'};
}
/** Any unknown/expired outcome is locked; never re-sign or automatically reserve again. */
export function canEchoSign(state:EchoTradeState):boolean {return state==='reserved';}
export function canEchoBroadcast(state:EchoTradeState, signedPayloadPersisted:boolean):boolean {
 return state==='signed' && signedPayloadPersisted;
}
