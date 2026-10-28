import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo atomic reservation verified-evidence denials',()=>{
 it('rejects missing caller, daily window and loss verification without writing an intent',async()=>{
  const db=new PGlite();
  try{
   for(const f of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_wallet_budget.sql',
     'echo_admin_shadow_budget_evidence_hardening.sql','echo_admin_shadow_atomic_reservation.sql'])
    await db.exec(await readFile(new URL(f,dir),'utf8'));
   await db.query('INSERT INTO echo_admin_execution_controls(execution_wallet,emergency_stop) VALUES($1,false)',[wallet]);
   await db.query(`INSERT INTO echo_admin_shadow_wallet_budget
    (execution_wallet,observed_balance_lamports,min_reserve_lamports,daily_gross_cap_lamports,
     daily_loss_limit_lamports,reconciliation_fresh,rpc_healthy,observed_at,
     daily_loss_verified,daily_window_verified,caller_evidence_verified,daily_window_start)
    VALUES($1,500000000,100000000,300000000,150000000,true,true,now(),false,false,false,now())`,[wallet]);
   const attempt=async()=>{
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try{
     await db.exec(`SET LOCAL echo.shadow_reservations_enabled='on'`);
     const r=await db.query<{echo_admin_shadow_reserve_atomic:boolean}>(
      'SELECT echo_admin_shadow_reserve_atomic($1,$2,$3,$4,$5,$6)',
      [wallet,mint,wallet,'source',100000000,1000000]);
     await db.exec('COMMIT');return r.rows[0]!.echo_admin_shadow_reserve_atomic;
    }catch(e){await db.exec('ROLLBACK');throw e;}
   };
   assert.equal(await attempt(),false);
   await db.query('UPDATE echo_admin_shadow_wallet_budget SET daily_loss_verified=true');
   assert.equal(await attempt(),false);
   await db.query('UPDATE echo_admin_shadow_wallet_budget SET daily_window_verified=true');
   assert.equal(await attempt(),false);
   const n=await db.query<{count:string}>('SELECT count(*)::text AS count FROM echo_admin_buy_intents');
   assert.equal(n.rows[0]!.count,'0');
  }finally{await db.close();}
 });
});
