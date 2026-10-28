import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo shadow fee evidence',()=>{
 it('records bounded fees and rejects duplicate or invalid debit evidence',async()=>{
  const db=new PGlite();
  try{
   for(const f of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_accounting_evidence.sql'])
    await db.exec(await readFile(new URL(f,dir),'utf8'));
   await db.query(`INSERT INTO echo_admin_buy_intents
    (execution_wallet,mint,caller_wallet,source_signature,amount_lamports)
    VALUES($1,$2,'caller','source',100000000)`,[wallet,mint]);
   const insert=(pre:number,post:number,fee:number)=>db.query(`INSERT INTO echo_admin_shadow_accounting_evidence
    (execution_wallet,mint,transaction_signature,pre_balance_lamports,post_balance_lamports,
     verified_fee_lamports,finalized_success,trusted_rpc)
    VALUES($1,$2,'signature',$3,$4,$5,true,true)`,[wallet,mint,pre,post,fee]);
   await assert.rejects(insert(100,101,1));
   await assert.rejects(insert(100,90,11));
   await insert(100,90,1);
   await assert.rejects(insert(100,90,1));
   const result=await db.query<{observed_debit_lamports:string}>(
    'SELECT observed_debit_lamports FROM echo_admin_shadow_accounting_evidence');
   assert.equal(BigInt(result.rows[0]!.observed_debit_lamports),10n);
  }finally{await db.close();}
 });
});
