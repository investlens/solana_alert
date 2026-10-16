import test from 'node:test';import assert from 'node:assert/strict';
import {encodeAbiParameters,parseAbiParameters} from 'viem';
import {providerPreflight} from '../preflight.js';import type {Reader} from '../providers.js';
const token='0x'+'a'.repeat(40),hash='0x'+'e'.repeat(64);
test('preflight validates exact chain, canonical token and explorer identity within eight reads',async()=>{
 let calls=0;const r:Reader={requests:()=>calls,security:async()=>{},pairs:async()=>{},rpc:async(_c,m)=>{calls++;return m==='eth_chainId'?'0x1237':m==='eth_blockNumber'?'0x10':m==='eth_getBlockByNumber'?{number:'0x10',hash}:m==='eth_getCode'?'0x6001':encodeAbiParameters(parseAbiParameters('uint256'),[100n]);},explorer:async(_c,p)=>{calls++;return p.includes('/holders')?{items:[]}:{hash:token,is_contract:true};}};
 assert.equal((await providerPreflight(r,'robinhood',token)).ready,true);assert.equal(calls,8);
 r.explorer=async()=>{throw Error('Research provider HTTP 403 https://private.example/secret');};
 const result=await providerPreflight(r,'robinhood',token);assert.equal(result.ready,false);assert.equal(result.checks[1].reason,'HTTP_403');assert.equal(JSON.stringify(result).includes('secret'),false);
 r.rpc=async()=> '0x1';assert.equal((await providerPreflight(r,'robinhood',token)).checks[0].reason,'CHAIN_MISMATCH');
});
