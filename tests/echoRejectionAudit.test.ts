import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoRejectionAudit } from '../src/echo/rejectionAudit.js';

test('private rejection audit is bounded, deduped and survives reload', async () => {
  const dir = await mkdtemp(join(tmpdir(),'alphaos-echo-reject-'));
  const file = join(dir,'audit.json');
  try {
    const audit = new EchoRejectionAudit(file,2);
    await audit.load();
    const s1='1'.repeat(64),s2='2'.repeat(64),s3='3'.repeat(64);
    await audit.add({signature:s1,reason:'wallet_not_signer',at:1});
    await audit.add({signature:s1,reason:'wallet_not_signer',at:1});
    await audit.add({signature:s2,reason:'unsupported_program_or_instruction',at:2});
    assert.equal(audit.summary().sampled,2);
    await audit.add({signature:s3,reason:'unsupported_quote',at:3});
    assert.deepEqual(audit.snapshot().map(x=>x.signature),[s2,s3]);
    const reloaded=new EchoRejectionAudit(file,2);
    await reloaded.load();
    assert.deepEqual(reloaded.snapshot(),audit.snapshot());
    assert.equal((await readFile(file,'utf8')).includes(s1),false);
    assert.equal(reloaded.summary().rawSignaturesLogged,false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('audit ignores invalid signatures',async()=>{
  const dir = await mkdtemp(join(tmpdir(),'alphaos-echo-reject-'));
  try {
    const audit=new EchoRejectionAudit(join(dir,'audit.json'),2);
    await audit.add({signature:'invalid',reason:'unsupported_program_or_instruction',at:1});
    assert.equal(audit.summary().sampled,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
