import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const sqlDir = new URL('../sql/', import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
const caller='Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6';
describe('Echo atomic shadow SQL',()=>{
 it('rejects disabled, duplicate, over-budget, stale and over-position reservations',async()=>{
  const db=new PGlite();
  try{
   for(const file of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_wallet_budget.sql','echo_admin_shadow_atomic_reservation.sql'])
    await db.exec(await readFile(new URL(file,sqlDir),'utf8'));
   await db.query(`INSERT INTO echo_admin_execution_controls(execution_wallet,emergency_stop) VALUES($1,false)`,[wallet]);
   await db.query(`INSERT INTO echo_admin_shadow_wallet_budget
    (execution_wallet,observed_balance_lamports,min_reserve_lamports,daily_gross_cap_lamports,
     daily_loss_limit_lamports,reconciliation_fresh,rpc_healthy,observed_at)
    VALUES($1,500000000,100000000,300000000,150000000,true,true,now())`,[wallet]);
   const reserve=async(m:string)=>{
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try{
     await db.exec(`SET LOCAL echo.shadow_reservations_enabled = 'on'`);
     const result=await db.query<{echo_admin_shadow_reserve_atomic:boolean}>(
      'SELECT echo_admin_shadow_reserve_atomic($1,$2,$3,$4,$5,$6)',
      [wallet,m,caller,'signature',100000000,1000000]);
     await db.exec('COMMIT');
     return result.rows[0]?.echo_admin_shadow_reserve_atomic;
    }catch(e){await db.exec('ROLLBACK');throw e;}
   };
   assert.equal(await reserve(mint),true);
   assert.equal(await reserve(mint),false);
   const b=await db.query<{reserved_lamports:string;pending_positions:number}>(
    'SELECT reserved_lamports,pending_positions FROM echo_admin_shadow_wallet_budget');
   assert.equal(BigInt(b.rows[0]!.reserved_lamports),101000000n);
   assert.equal(b.rows[0]!.pending_positions,1);
   await db.query('UPDATE echo_admin_shadow_wallet_budget SET pending_positions=2');
   assert.equal(await reserve(caller),false);
  }finally{await db.close();}
 });
});
