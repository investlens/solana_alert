/**
 * Echo pilot Pump venue routing. Pure and fail-closed.
 * Routing is a monitoring hint, NEVER a trade authorization.
 * On-chain Pump/PumpSwap instruction parsing and execution remain separate.
 */
export const PUMP_CURVE_PROGRAM='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_SWAP_PROGRAM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export type PumpVenue='pump_curve'|'pump_swap'|'unsupported';
export function classifyPumpVenue(programIds:readonly string[]):Readonly<{
 venue:PumpVenue;reason:string;verifiedBuy:false
}>{
 const curve=programIds.includes(PUMP_CURVE_PROGRAM);
 const swap=programIds.includes(PUMP_SWAP_PROGRAM);
 if(curve&&swap)return {venue:'unsupported',reason:'AMBIGUOUS_MULTIPLE_PUMP_PROGRAMS',verifiedBuy:false};
 if(curve)return {venue:'pump_curve',reason:'CURVE_PROGRAM_PRESENT_ONLY',verifiedBuy:false};
 if(swap)return {venue:'pump_swap',reason:'PUMPSWAP_PROGRAM_PRESENT_ONLY',verifiedBuy:false};
 return {venue:'unsupported',reason:'NO_SUPPORTED_PUMP_PROGRAM',verifiedBuy:false};
}
