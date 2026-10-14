export type Chain='robinhood'|'arc';
export type Quality='VERIFIED'|'SOURCE_REPORTED'|'OBSERVED_CONNECTION'|'UNVERIFIED';
export type Section='identity'|'developer'|'connections'|'launches'|'holders'|'controls'|'market'|'social'|'selling';
export type Evidence={source:string;observedAt:string;url?:string;block?:string;transaction?:string};
export type Finding={id:string;section:Section;quality:Quality;severity:'INFO'|'CAUTION'|'RISK'|'UNKNOWN';summary:string;value?:string|number;subject?:string;evidence:Evidence[];limits?:string};
export type Report={version:1;chain:Chain;token:string;generatedAt:string;block?:string;findings:Finding[];coverage:Record<Section,'AVAILABLE'|'PARTIAL'|'UNAVAILABLE'>;limits:string[]};
export type Snapshot={chain:Chain;token:string;block:string;observedAt:string;supply:bigint;owner?:string;balances:Record<string,bigint>};
export const sections:Section[]=['identity','developer','connections','launches','holders','controls','market','social','selling'];
export const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v);
export const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
export function tokenAddress(v:unknown):string{if(!address(v)||/^0x0{40}$/i.test(v))throw Error('Invalid token contract');return v.toLowerCase();}
export function chainName(v:unknown):Chain{if(v!=='robinhood'&&v!=='arc')throw Error('Select Robinhood or ARC');return v;}
export function rawUnits(v:unknown):bigint|null{return typeof v==='string'&&/^\d{1,78}$/.test(v)?BigInt(v):null;}
export function percentage(n:bigint,supply:bigint):string|null{if(n<0n||supply<=0n||n>supply)return null;return `${n*1000000n/supply/10000n}.${(n*1000000n/supply%10000n).toString().padStart(4,'0')}%`;}
export const burn=(v:string)=>/^0x(?:0{40}|0{36}dead)$/i.test(v);
