import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const sqlDir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo shadow confirmed settlement migration',()=>{
 it('requires evidence, is idempotent and preserves reserved balance',async()=>{
  const db=new PGlite();
  try{
   for(const file of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_wallet_budget.sql',
    'echo_admin_shadow_reconciliation_observations.sql','echo_admin_shadow_confirm_buy.sql'])
    await db.exec(await readFile(new URL(file,sqlDir),'utf8'));
   await db.query('INSERT INTO echo_admin_execution_controls(execution_wallet) VALUES($1)',[wallet]);
   await db.query('INSERT INTO echo_admin_shadow_wallet_budget(execution_wallet,pending_positions,reserved_lamports) VALUES($1,1,101000000)',[wallet]);
   await db.query(`INSERT INTO echo_admin_buy_intents(execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state,transaction_signature,signed_transaction_ciphertext)
    VALUES($1,$2,'caller','source',100000000,'submitted','signature',decode('00','hex'))`,[wallet,mint]);
   const evidence=await db.query<{id:string}>(`INSERT INTO echo_admin_shadow_reconciliation_observations
    (execution_wallet,mint,transaction_signature,rpc_trusted,history_caught_up,finalized_success,token_increase_verified,proposed_state,evidence_reason)
    VALUES($1,$2,'signature',true,true,true,true,'confirmed','FINALIZED_BUY_VERIFIED') RETURNING id`,[wallet,mint]);
   const id=evidence.rows[0]!.id;
   const settle=async()=>{
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try{
     await db.exec(`SET LOCAL echo.shadow_settlement_enabled='on'`);
     const r=await db.query<{echo_admin_shadow_confirm_buy:boolean}>(
      'SELECT echo_admin_shadow_confirm_buy($1,$2,$3)',[wallet,mint,id]);
     await db.exec('COMMIT');
     return r.rows[0]!.echo_admin_shadow_confirm_buy;
    }catch(e){await db.exec('ROLLBACK');throw e;}
   };
   assert.equal(await settle(),true);
   assert.equal(await settle(),false);
   const b=await db.query<{pending_positions:number;open_positions:number;reserved_lamports:string}>(
    'SELECT pending_positions,open_positions,reserved_lamports FROM echo_admin_shadow_wallet_budget');
   assert.equal(b.rows[0]!.pending_positions,0);
   assert.equal(b.rows[0]!.open_positions,1);
   assert.equal(BigInt(b.rows[0]!.reserved_lamports),101000000n);
  }finally{await db.close();}
 });
});
