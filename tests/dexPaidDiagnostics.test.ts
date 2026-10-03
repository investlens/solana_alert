import test from 'node:test';
import assert from 'node:assert/strict';
import {createDexPaidDiagnostics} from '../src/chains/robinhood/dexPaidDiagnostics.js';
test('fixed reason counters emit once per window and reset without retaining token records',()=>{
 const summaries: unknown[]=[];
 const record=createDexPaidDiagnostics(summary=>summaries.push(summary),300_000);
 record('NO_PAID_ORDER',0);record('PROVIDER_UNAVAILABLE',100);
 assert.equal(summaries.length,0);
 record('NO_PAID_ORDER',300_000);
 assert.deepEqual(summaries,[{windowSeconds:300,checks:3,outcomes:{NO_PAID_ORDER:2,PROVIDER_UNAVAILABLE:1}}]);
 record('PAYMENT_OUTSIDE_WINDOW',600_000);
 assert.deepEqual(summaries[1],{windowSeconds:300,checks:1,outcomes:{PAYMENT_OUTSIDE_WINDOW:1}});
});
