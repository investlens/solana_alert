import {verifyCustomTokenExit} from './customTokenExitVerification.js';
export async function automaticRunnerExitGate(row:{chain:string;token:string;pair_id:string}){
 if(row.chain!=='arc')return {allowed:false,reason:'Handled by chain owner',observedAt:Date.now()};
 return verifyCustomTokenExit({chain:'arc',token:row.token,pairId:row.pair_id});
}
