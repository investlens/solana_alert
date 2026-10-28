import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const dir=new URL('../sql/',import.meta.url);
const caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
describe('Echo exact caller evidence deny-by-default SQL',()=>{
 it('prevents untrusted verified evidence insertion even for allowed caller',async()=>{
  const db=new PGlite();
  try{
   await db.exec(await readFile(new URL('echo_admin_shadow_per_intent_evidence.sql',dir),'utf8'));
   await assert.rejects(db.query(
    'INSERT INTO echo_admin_verified_caller_buy_evidence(caller_wallet,source_signature,mint,verified,finalized) VALUES($1,$2,$3,true,true)',
    [caller,'test-signature','test-mint']));
   const n=await db.query<{n:string}>(
    'SELECT count(*)::text AS n FROM echo_admin_verified_caller_buy_evidence');
   assert.equal(n.rows[0]!.n,'0');
  }finally{await db.close();}
 });
 it('rejects unknown caller and enforces signature/mint uniqueness',async()=>{
  const db=new PGlite();
  try{
   await db.exec(await readFile(new URL('echo_admin_shadow_per_intent_evidence.sql',dir),'utf8'));
   await assert.rejects(db.query(
    'INSERT INTO echo_admin_verified_caller_buy_evidence(caller_wallet,source_signature,mint) VALUES($1,$2,$3)',
    ['not-allowlisted','sig','mint']));
   await db.query('INSERT INTO echo_admin_verified_caller_buy_evidence(caller_wallet,source_signature,mint) VALUES($1,$2,$3)',
    [caller,'sig','mint']);
   await assert.rejects(db.query('INSERT INTO echo_admin_verified_caller_buy_evidence(caller_wallet,source_signature,mint) VALUES($1,$2,$3)',
    [caller,'sig','mint']));
  }finally{await db.close();}
 });
});
