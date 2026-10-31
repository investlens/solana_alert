import test from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableAccount,Keypair,PublicKey,TransactionInstruction,
 TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {inspectEchoV0LookupTables,ECHO_LOOKUP_INSPECTION_GRANTS_SIGNING} from
 '../src/echo/readOnlyAddressLookupInspection.js';
const payer=Keypair.generate().publicKey;
const program=Keypair.generate().publicKey;
const lookupKey=Keypair.generate().publicKey;
const table=new AddressLookupTableAccount({
 key:lookupKey,state:{
  deactivationSlot:BigInt('18446744073709551615'),
  lastExtendedSlot:0,lastExtendedSlotStartIndex:0,
  authority:undefined,addresses:[program]
 }
});
const message=new TransactionMessage({
 payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[new TransactionInstruction({programId:program,keys:[],data:Buffer.from([1])})]
}).compileToV0Message([table]);
const raw=Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
test('ALT-backed v0 instruction can be independently resolved for read-only diagnostics',async()=>{
 assert.equal(message.addressTableLookups.length,1);
 let calls=0;
 const checked=await inspectEchoV0LookupTables(raw,{lookup:async(key:PublicKey)=>{
  calls++;assert.equal(key.toBase58(),lookupKey.toBase58());return table;
 }});
 assert.equal(checked.ok,true);
 if(checked.ok){
  assert.deepEqual(checked.programIds,[program.toBase58()]);
  assert.deepEqual(checked.unknownPrograms,[program.toBase58()]);
  assert.equal(checked.mode,'INSPECT_ONLY');
 }
 assert.equal(calls,1);
 assert.equal(ECHO_LOOKUP_INSPECTION_GRANTS_SIGNING,false);
});
test('missing, deactivated and RPC-failed lookup tables are denied',async()=>{
 const absent=await inspectEchoV0LookupTables(raw,{lookup:async()=>null});
 assert.deepEqual(absent,{ok:false,reason:'LOOKUP_ACCOUNT_MISSING'});
 const dead=new AddressLookupTableAccount({key:lookupKey,state:{...table.state,deactivationSlot:123n}});
 assert.deepEqual(await inspectEchoV0LookupTables(raw,{lookup:async()=>dead}),
  {ok:false,reason:'LOOKUP_ACCOUNT_DEACTIVATED'});
 const offline=await inspectEchoV0LookupTables(raw,{lookup:async()=>{throw Error('offline')}});
 assert.deepEqual(offline,{ok:false,reason:'LOOKUP_RPC_UNAVAILABLE'});
});
test('invalid transaction bytes rejected before any provider access',async()=>{
 let called=false;
 const result=await inspectEchoV0LookupTables('not-base64',{
  lookup:async()=>{called=true;return table;}
 });
 assert.equal(result.ok,false);
 assert.equal(called,false);
});
