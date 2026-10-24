import test from 'node:test';
import assert from 'node:assert/strict';
import { echoCard, type EchoSignal } from '../src/echo/signals.js';

const signal: EchoSignal = {
  id:'fixture',wallet:'6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP',
  caller:'Cupsey',signature:'x'.repeat(80),timestamp:1000,
  mint:'Biiv46yBzZwwdg3HvYQ52yPXmnMb5EnE8dboTx2qpump',
  side:'BUY',tokenAmount:11465706.82,quoteAmount:14.8137,quoteSymbol:'SOL',
  quoteBasis:'wallet SOL net change; includes fees/rent'
};
test('Echo UI renders token name once, retains CA and exact quote disclaimer',()=>{
  const card=echoCard(signal,1001,{name:'Why would I deceive you?',symbol:'ELIZABETH',marketCap:114929,liquidity:30438});
  assert.equal((card.match(/Why would I deceive you\?/g)||[]).length,1);
  assert.match(card,/ELIZABETH/);assert.match(card,/114,929/);assert.match(card,/30,438/);
  assert.match(card,/not exact trade size/);assert.match(card,/Biiv46yBzZwwdg3HvYQ52yPXmnMb5EnE8dboTx2qpump/);
  assert.doesNotMatch(card,/security not assessed.*Third-party snapshot/s);
});
test('Echo UI escapes third party token metadata and works without enrichment',()=>{
  const card=echoCard(signal,1001,{name:'<bad>&name',symbol:'<T>',marketCap:null,liquidity:null});
  assert.match(card,/&lt;bad&gt;&amp;name/);assert.doesNotMatch(card,/<bad>/);
  assert.match(echoCard(signal,1001),/Name pending/);
});