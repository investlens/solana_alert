import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoResearch} from '../src/echo/research.js';
import {openPaperStop,updatePaperStop} from '../src/echo/signals.js';
test('all paper opportunities are counted even when the pricing cap is reached',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'echo-cap-')); const path=join(dir,'research.json');
 try {
  const a=new EchoResearch(path); await a.load();
  const mint='So11111111111111111111111111111111111111112',deliveryAt=Date.now()/1000;
  for(let i=0;i<66;i++) await a.addBuy({caller:'fixture',mint,signature:String(i).padStart(64,'1'),deliveryAt});
  const data=JSON.parse(await readFile(path,'utf8'));
  assert.equal(data.trials.length,66);
  assert.equal(data.trials.filter((v:any)=>v.status==='CENSORED').length,2);
  assert.equal(data.trials.filter((v:any)=>v.status==='AWAITING_PRICE').length,64);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('existing paper trailing stop uses the agreed ROI tiers',()=>{
 let s=openPaperStop(100);assert.equal(s.stop,80);
 s=updatePaperStop(s,120);assert.equal(s.stop,100);
 s=updatePaperStop(s,130);assert.equal(s.stop,110.5);
 s=updatePaperStop(s,160);assert.equal(s.stop,140.8);
 s=updatePaperStop(s,200);assert.equal(s.stop,180);
 s=updatePaperStop(s,179);assert.equal(s.closed,true);
});
