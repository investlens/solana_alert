import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo shadow accounting settlement ledger',()=>{
 it('accepts one matching finalized debit and never releases funds',async()=>{
  const db=new PGlite();
  try{
   for(const f of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_wallet_budget.sql',
    'echo_admin_shadow_accounting_evidence.sql','echo_admin_shadow_record_settlement.sql'])
    await db.exec(await readFile(new URL(f,dir),'utf8'));
   await db.query('INSERT INTO echo_admin_execution_controls(execution_wallet) VALUES($1)',[wallet]);
   await db.query('INSERT INTO echo_admin_shadow_wallet_budget(execution_wallet,reserved_lamports,daily_spent_lamports) VALUES($1,101000000,101000000)',[wallet]);
   await db.query(`INSERT INTO echo_admin_buy_intents
    (execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state,transaction_signature,signed_transaction_ciphertext)
    VALUES($1,$2,'caller','source',100000000,'confirmed','sig',decode('00','hex'))`,[wallet,mint]);
   const evidence=await db.query<{id:string}>(`INSERT INTO echo_admin_shadow_accounting_evidence
    (execution_wallet,mint,transaction_signature,pre_balance_lamports,post_balance_lamports,
     verified_fee_lamports,finalized_success,trusted_rpc)
    VALUES($1,$2,'sig',500000000,399000000,1000000,true,true) RETURNING id`,[wallet,mint]);
   const id=evidence.rows[0]!.id;
   const settle=async()=>{
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try{
     await db.exec(`SET LOCAL echo.shadow_accounting_enabled='on'`);
     const r=await db.query<{echo_admin_shadow_record_settlement:boolean}>(
      'SELECT echo_admin_shadow_record_settlement($1,$2,$3)',[wallet,mint,id]);
     await db.exec('COMMIT');return r.rows[0]!.echo_admin_shadow_record_settlement;
    }catch(e){await db.exec('ROLLBACK');throw e;}
   };
   assert.equal(await settle(),true);
   assert.equal(await settle(),false);
   const b=await db.query<{reserved_lamports:string;daily_spent_lamports:string}>(
    'SELECT reserved_lamports,daily_spent_lamports FROM echo_admin_shadow_wallet_budget');
   assert.equal(BigInt(b.rows[0]!.reserved_lamports),101000000n);
   assert.equal(BigInt(b.rows[0]!.daily_spent_lamports),101000000n);
  }finally{await db.close();}
 });
});
