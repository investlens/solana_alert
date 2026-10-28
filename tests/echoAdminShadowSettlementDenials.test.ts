import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo settlement denial cases',()=>{
 it('rejects mismatched evidence, unsafe states, and missing feature flag',async()=>{
  const db=new PGlite();
  try{
   for(const f of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_wallet_budget.sql',
     'echo_admin_shadow_reconciliation_observations.sql','echo_admin_shadow_confirm_buy.sql'])
    await db.exec(await readFile(new URL(f,dir),'utf8'));
   await db.query('INSERT INTO echo_admin_execution_controls(execution_wallet) VALUES($1)',[wallet]);
   await db.query('INSERT INTO echo_admin_shadow_wallet_budget(execution_wallet,pending_positions,reserved_lamports) VALUES($1,1,101000000)',[wallet]);
   await db.query(`INSERT INTO echo_admin_buy_intents
    (execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state,transaction_signature,signed_transaction_ciphertext)
    VALUES($1,$2,'caller','source',100000000,'submitted','actual',decode('00','hex'))`,[wallet,mint]);
   const observation=await db.query<{id:string}>(`INSERT INTO echo_admin_shadow_reconciliation_observations
    (execution_wallet,mint,transaction_signature,rpc_trusted,history_caught_up,finalized_success,token_increase_verified,proposed_state,evidence_reason)
    VALUES($1,$2,'wrong',true,true,true,true,'confirmed','FINALIZED_BUY_VERIFIED') RETURNING id`,[wallet,mint]);
   const id=observation.rows[0]!.id;
   const call=async()=>{
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try{
     await db.exec(`SET LOCAL echo.shadow_settlement_enabled='on'`);
     const r=await db.query<{echo_admin_shadow_confirm_buy:boolean}>(
      'SELECT echo_admin_shadow_confirm_buy($1,$2,$3)',[wallet,mint,id]);
     await db.exec('COMMIT');return r.rows[0]!.echo_admin_shadow_confirm_buy;
    }catch(e){await db.exec('ROLLBACK');throw e;}
   };
   assert.equal(await call(),false);
   const state=await db.query<{state:string}>('SELECT state FROM echo_admin_buy_intents');
   assert.equal(state.rows[0]!.state,'submitted');
   await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
   await assert.rejects(db.query('SELECT echo_admin_shadow_confirm_buy($1,$2,$3)',[wallet,mint,id]));
   await db.exec('ROLLBACK');
  }finally{await db.close();}
 });
});
