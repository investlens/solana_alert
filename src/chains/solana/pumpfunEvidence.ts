import { Connection, PublicKey } from '@solana/web3.js';
// Layouts pinned to pump-fun/pump-public-docs idl/pump.json and pump_amm.json,
// reviewed 2026-10-10. Unknown layouts/modes fail closed; no transactions sent.
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_SWAP = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const WSOL = 'So11111111111111111111111111111111111111112';
const SPL='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const curveTag=Buffer.from([23,183,248,55,96,216,172,96]);
const poolTag=Buffer.from([241,154,109,4,17,177,109,188]);
export function decodePumpCurve(data:Buffer,owner:string) {
 if(owner!==PUMP_PROGRAM.toBase58()||data.length<81||!data.subarray(0,8).equals(curveTag))throw new Error('Pump origin not verified');
 if(data.length>81&&data[81]!==0)throw new Error('Unsupported Pump mayhem mode');
 if(data.length>=115) {const quote=new PublicKey(data.subarray(83,115)).toBase58();if(quote!==PublicKey.default.toBase58()&&quote!==WSOL)throw new Error('Unsupported quote mint');}
 const supply=data.readBigUInt64LE(40);if(supply<=0n)throw new Error('Invalid curve supply');
 const creator=new PublicKey(data.subarray(49,81)).toBase58();if(creator===PublicKey.default.toBase58())throw new Error('Creator fee wallet missing');
 return {creator,complete:data[48]===1,supply};
}
export function decodePumpPool(data:Buffer,owner:string,mint:string) {
 if(owner!==PUMP_SWAP.toBase58()||data.length<243||!data.subarray(0,8).equals(poolTag))throw new Error('PumpSwap pool not verified');
 const key=(offset:number)=>new PublicKey(data.subarray(offset,offset+32)).toBase58();
 if(key(43)!==mint||key(75)!==WSOL)throw new Error('Pool token/quote mismatch');
 if(data.length>243&&data[243]!==0)throw new Error('Unsupported pool mode');
 return {baseVault:key(139),quoteVault:key(171),creator:key(211)};
}
export function decodeSupportedMint(data:Buffer,owner:string) {
 if(![SPL,SPL2022].includes(owner)||data.length<82||data[45]!==1)throw new Error('Unsupported mint');
 if(data.readUInt32LE(0)!==0||data.readUInt32LE(46)!==0)throw new Error('Active mint/freeze authority');
 if(owner===SPL&&data.length!==82)throw new Error('Unexpected SPL mint layout');
 if(owner===SPL2022&&data.length>82) {
  if(data.length<166||data[165]!==1)throw new Error('Unsupported Token-2022 layout');
  for(let at=166;at<data.length;) {
   if(data.subarray(at).every(v=>v===0))break;
   if(at+4>data.length)throw new Error('Truncated mint extension');
   const type=data.readUInt16LE(at),length=data.readUInt16LE(at+2);
   if(![18,19].includes(type)||at+4+length>data.length)throw new Error('Unsupported Token-2022 extension');
   at+=4+length;
  }
 }
 const supply=data.readBigUInt64LE(36),decimals=data[44];if(supply<=0n||decimals>12)throw new Error('Invalid mint supply');
 return {supply,decimals};
}
export type PumpEvidence={creator:string;devPercent:number;top10SamplePercent:number;supply:number;slot:number;observedAt:number};
let connection:Connection|null=null;
function rpc() {
 const url=process.env.SOLANA_RPC_URL || (process.env.HELIUS_API_KEY?`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`:'https://api.mainnet-beta.solana.com');
 connection??=new Connection(url,{commitment:'confirmed',disableRetryOnRateLimit:true,
  fetch:((url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})) as typeof fetch});
 return connection;
}
export async function readPumpEvidence(mint:string,pair:string):Promise<PumpEvidence> {
 const mintKey=new PublicKey(mint),poolKey=new PublicKey(pair);
 const [curveKey]=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),mintKey.toBuffer()],PUMP_PROGRAM);
 const accounts=await rpc().getMultipleAccountsInfoAndContext([curveKey,mintKey,poolKey],'confirmed');
 const [curveAccount,mintAccount,poolAccount]=accounts.value;
 if(!curveAccount||!mintAccount||!poolAccount)throw new Error('On-chain Pump evidence missing');
 const curve=decodePumpCurve(curveAccount.data,curveAccount.owner.toBase58());
 if(!curve.complete)throw new Error('Pre-bond curve; DEX momentum not eligible');
 const token=decodeSupportedMint(mintAccount.data,mintAccount.owner.toBase58());
 const pool=decodePumpPool(poolAccount.data,poolAccount.owner.toBase58(),mint);
 if(pool.creator!==curve.creator)throw new Error('Curve/pool creator fee wallet mismatch');
 const balances=await rpc().getParsedTokenAccountsByOwner(new PublicKey(curve.creator),{mint:mintKey},'confirmed');
 if(balances.context.slot<accounts.context.slot)throw new Error('Creator balance predates origin evidence');
 let owned=0n;
 for(const item of balances.value) {const info=item.account.data.parsed?.info;if(info?.mint!==mint||info?.owner!==curve.creator)throw new Error('Creator balance mismatch');owned+=BigInt(info.tokenAmount.amount);}
 if(owned>token.supply)throw new Error('Invalid creator balance');
 const largest=await rpc().getTokenLargestAccounts(mintKey,'confirmed');
 const keys=largest.value.map(v=>new PublicKey(v.address));
 if(largest.context.slot<accounts.context.slot)throw new Error('Holder list predates origin evidence');
 const holders=await rpc().getMultipleAccountsInfoAndContext(keys,{commitment:'confirmed',minContextSlot:accounts.context.slot});
 const byOwner=new Map<string,bigint>();
 for(let i=0;i<holders.value.length;i++) {
  const account=holders.value[i];if(!account||account.data.length<165||![SPL,SPL2022].includes(account.owner.toBase58()))throw new Error('Holder account not verified');
  const data=account.data;if(new PublicKey(data.subarray(0,32)).toBase58()!==mint)throw new Error('Holder mint mismatch');
  if(keys[i].toBase58()===pool.baseVault)continue;
  const owner=new PublicKey(data.subarray(32,64)).toBase58();if(owner===curveKey.toBase58())continue;
  byOwner.set(owner,(byOwner.get(owner)??0n)+data.readBigUInt64LE(64));
 }
 const total=[...byOwner.values()].sort((a,b)=>a>b?-1:a<b?1:0).slice(0,10).reduce((a,b)=>a+b,0n);
 if(total>token.supply)throw new Error('Holder balance inconsistent');
 const percent=(value:bigint)=>Number(value*1_000_000n/token.supply)/10_000;
 return {creator:curve.creator,devPercent:percent(owned),top10SamplePercent:percent(total),supply:Number(token.supply)/10**token.decimals,slot:accounts.context.slot,observedAt:Date.now()};
}
export async function checkPumpRpc():Promise<void> {await rpc().getSlot('confirmed');}
