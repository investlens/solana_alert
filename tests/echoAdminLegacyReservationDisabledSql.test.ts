import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo legacy shadow reservation disabled',()=>{
 it('cannot bypass the budget and create a buy intent',async()=>{
  const db=new PGlite();
  try{
   for(const f of ['echo_admin_pilot_shadow_ledger.sql',
    'echo_admin_shadow_wallet_budget.sql',
    'echo_admin_shadow_budget_evidence_hardening.sql',
    'echo_admin_shadow_atomic_reservation.sql',
    'echo_admin_disable_legacy_reservation.sql'])
     await db.exec(await readFile(new URL(f,dir),'utf8'));
   await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
   try{
    await db.exec(`SET LOCAL echo.shadow_reservations_enabled='on'`);
    await assert.rejects(
     db.query('SELECT echo_admin_shadow_reserve($1,$2,$3,$4,$5)',
      [wallet,mint,wallet,'source',100000000]),
     /legacy shadow reservation disabled/);
   }finally{await db.exec('ROLLBACK');}
   const r=await db.query<{count:string}>('SELECT count(*)::text AS count FROM echo_admin_buy_intents');
   assert.equal(r.rows[0]!.count,'0');
  }finally{await db.close();}
 });
});
