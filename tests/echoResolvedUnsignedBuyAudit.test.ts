import test from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableAccount,ComputeBudgetProgram,Keypair,PublicKey,
 TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {auditEchoResolvedUnsignedBuy,ECHO_RESOLVED_BUY_ROUTE_GRANTS_SIGNING}
 from '../src/echo/resolvedUnsignedBuyAudit.js';
const payer=Keypair.generate().publicKey,mint=Keypair.generate().publicKey;
const token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ataProgram=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const [destination]=PublicKey.findProgramAddressSync(
 [payer.toBuffer(),token.toBuffer(),mint.toBuffer()],ataProgram);
const pool=Keypair.generate().publicKey,route=Keypair.generate().publicKey;
const tableKey=Keypair.generate().publicKey;
const table=new AddressLookupTableAccount({key:tableKey,state:{
 deactivationSlot:18446744073709551615n,lastExtendedSlot:0,
 lastExtendedSlotStartIndex:0,authority:undefined,addresses:[pool,destination]
}});
const provider={lookup:async(key:PublicKey)=>key.equals(tableKey)?table:null};
const accounts={getAccounts:async(keys:readonly PublicKey[])=>{
 assert.deepEqual(keys.map(k=>k.toBase58()),[mint.toBase58()]);
 return [{owner:token,data:new Uint8Array(82),executable:false}];
}};
function build({withDestination=true,wrongPayer=false,priority=1000,directTransfer=false,
 lookups=true,duplicateCompute=false}:{
 withDestination?:boolean;wrongPayer?:boolean;priority?:number;directTransfer?:boolean;
 lookups?:boolean;duplicateCompute?:boolean
}={}){
 const keys=[{pubkey:pool,isSigner:false,isWritable:true}];
 if(withDestination)keys.push({pubkey:destination,isSigner:false,isWritable:true});
 const ix=[ComputeBudgetProgram.setComputeUnitLimit({units:200000}),
  ComputeBudgetProgram.setComputeUnitPrice({microLamports:priority})];
 if(duplicateCompute)ix.push(ComputeBudgetProgram.setComputeUnitLimit({units:10000}));
 ix.push(directTransfer?SystemProgram.transfer({
 fromPubkey:payer,toPubkey:pool,lamports:100}):
 new TransactionInstruction({programId:route,keys,data:Buffer.from([4,5])}));
 const msg=new TransactionMessage({payerKey:wrongPayer?Keypair.generate().publicKey:payer,
  recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:ix
 }).compileToV0Message(lookups?[table]:[]);
 return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}
const run=(base64:string,override:any={})=>auditEchoResolvedUnsignedBuy({
 base64,wallet:payer.toBase58(),mint:mint.toBase58(),
 lookupProvider:provider,accountProvider:accounts,...override});
test('ALT-backed Pump-like unsigned route resolves destination, remains audit-only',async()=>{
 const result=await run(build());
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.lookupTables,1);
  assert.equal(result.destinationTokenAccount,destination.toBase58());
  assert.ok(result.writableAccounts.includes(destination.toBase58()));
  assert.equal(result.expectedDestinationDerived,true);
  assert.equal(result.accountStateReads,1);
  assert.equal(result.lookupReads,1);
  assert.equal(result.priorityFeeLamports,'200');
  assert.deepEqual(result.unreviewedPrograms,[route.toBase58()]);
  assert.equal(result.economicOutcomeVerified,false);
  assert.equal(result.signingApproved,false);
 }
 assert.equal(ECHO_RESOLVED_BUY_ROUTE_GRANTS_SIGNING,false);
});
test('wrong fee payer and token destination denied',async()=>{
 assert.equal((await run(build({wrongPayer:true}))).ok,false);
 const missing=await run(build({withDestination:false}));
 assert.deepEqual(missing,{ok:false,reason:'WALLET_TOKEN_DESTINATION_NOT_WRITABLE',
  signingApproved:false,lookupReads:1,accountStateReads:1});
});
test('deactivated and missing lookup tables, incorrect mint owner denied',async()=>{
 const dead=new AddressLookupTableAccount({key:tableKey,
  state:{...table.state,deactivationSlot:99n}});
 assert.equal((await run(build(),{lookupProvider:{lookup:async()=>dead}})).ok,false);
 assert.equal((await run(build(),{lookupProvider:{lookup:async()=>null}})).ok,false);
 assert.equal((await run(build(),{accountProvider:{
  getAccounts:async()=>[{owner:SystemProgram.programId,data:new Uint8Array(82),executable:false}]
 }})).ok,false);
});
test('fee ceiling, duplicate compute and naked SOL transfer rejected',async()=>{
 assert.equal((await run(build({priority:4_000_000}))).ok,false);
 assert.equal((await run(build({duplicateCompute:true}))).ok,false);
 const sent=await run(build({directTransfer:true}));
 assert.equal(sent.ok,false); // without a swap program
});
test('invalid payload and failed RPC do not sign or submit',async()=>{
 const bad=await run('INVALID');
 assert.equal(bad.ok,false);
 const offline=await run(build(),{accountProvider:{getAccounts:async()=>{throw Error('offline')}}});
 assert.deepEqual(offline,{ok:false,reason:'ACCOUNT_STATE_UNAVAILABLE',
  signingApproved:false,lookupReads:1,accountStateReads:1});
});

test('canonical Token-2022 mint derives different ATA and never authorizes a legacy-token destination',async()=>{
 const token2022=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
 const original=build();
 const result=await run(original,{accountProvider:{getAccounts:async()=>[
  {owner:token2022,data:new Uint8Array(412),executable:false}
 ]}});
 assert.deepEqual(result,{ok:false,reason:'WALLET_TOKEN_DESTINATION_NOT_WRITABLE',
  signingApproved:false,lookupReads:1,accountStateReads:1});
});

test('a swap plus unrelated SOL transfer is denied even if the output ATA is writable',async()=>{
 const tx=new TransactionMessage({payerKey:payer,
  recentBlockhash:Keypair.generate().publicKey.toBase58(),
  instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:200000}),
   ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}),
   SystemProgram.transfer({fromPubkey:payer,toPubkey:pool,lamports:1000}),
   new TransactionInstruction({programId:route,
    keys:[{pubkey:pool,isSigner:false,isWritable:true},
          {pubkey:destination,isSigner:false,isWritable:true}],data:Buffer.from([9])})
  ]}).compileToV0Message([table]);
 const checked=await run(Buffer.from(new VersionedTransaction(tx).serialize()).toString('base64'));
 assert.equal(checked.ok,false);
 if(!checked.ok)assert.equal(checked.reason,'UNREVIEWED_SYSTEM_INSTRUCTION');
});
test('a swap with an unaudited token transfer is denied before destination checks',async()=>{
 const tx=new TransactionMessage({payerKey:payer,
  recentBlockhash:Keypair.generate().publicKey.toBase58(),
  instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:200000}),
   ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}),
   new TransactionInstruction({programId:token,
    keys:[{pubkey:destination,isSigner:false,isWritable:true}],data:Buffer.from([3,1])}),
   new TransactionInstruction({programId:route,
    keys:[{pubkey:pool,isSigner:false,isWritable:true},
          {pubkey:destination,isSigner:false,isWritable:true}],data:Buffer.from([9])})
  ]}).compileToV0Message([table]);
 const checked=await run(Buffer.from(new VersionedTransaction(tx).serialize()).toString('base64'));
 assert.equal(checked.ok,false);
 if(!checked.ok)assert.equal(checked.reason,'UNREVIEWED_TOKEN_INSTRUCTION');
});

test('canonical Token-2022 ATA passes structural audit and remains signing-disabled',async()=>{
 const token2022=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
 const [destination2022]=PublicKey.findProgramAddressSync([
  payer.toBuffer(),token2022.toBuffer(),mint.toBuffer()
 ],ataProgram);
 const alt22=new AddressLookupTableAccount({key:tableKey,state:{
  ...table.state,addresses:[pool,destination2022]
 }});
 const message=new TransactionMessage({payerKey:payer,
  recentBlockhash:Keypair.generate().publicKey.toBase58(),
  instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:200000}),
   ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}),
   new TransactionInstruction({programId:route,keys:[
    {pubkey:pool,isSigner:false,isWritable:true},
    {pubkey:destination2022,isSigner:false,isWritable:true}
   ],data:Buffer.from([1,2,3])})
  ]}).compileToV0Message([alt22]);
 const tx=Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
 const result=await run(tx,{
  lookupProvider:{lookup:async()=>alt22},
  accountProvider:{getAccounts:async()=>[{
   owner:token2022,data:new Uint8Array(412),executable:false
  }]}
 });
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.destinationTokenAccount,destination2022.toBase58());
  assert.ok(result.writableAccounts.includes(destination2022.toBase58()));
  assert.equal(result.expectedDestinationDerived,true);
  assert.equal(result.economicOutcomeVerified,false);
  assert.equal(result.signingApproved,false);
 }
});
