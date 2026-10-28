import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo restart observation queue',()=>{
 it('leases unresolved intents once without sending or retrying trades',async()=>{
  const db=new PGlite();
  try{
   for(const f of ['echo_admin_pilot_shadow_ledger.sql','echo_admin_shadow_recovery_queue.sql'])
    await db.exec(await readFile(new URL(f,dir),'utf8'));
   await db.query(`INSERT INTO echo_admin_buy_intents
    (execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state,transaction_signature,signed_transaction_ciphertext)
    VALUES($1,$2,'caller','source',100000000,'unknown','sig',decode('00','hex'))`,[wallet,mint]);
   await db.query('INSERT INTO echo_admin_shadow_recovery_queue(execution_wallet,mint) VALUES($1,$2)',[wallet,mint]);
   await db.exec('BEGIN');
   await db.exec(`SET LOCAL echo.shadow_observer_enabled='on'`);
   const first=await db.query('SELECT * FROM echo_admin_shadow_claim_observations($1,$2,$3)', ['worker-1',10,60]);
   const second=await db.query('SELECT * FROM echo_admin_shadow_claim_observations($1,$2,$3)', ['worker-2',10,60]);
   assert.equal(first.rows.length,1);
   assert.equal(second.rows.length,0);
   await db.exec('COMMIT');
  }finally{await db.close();}
 });
});
