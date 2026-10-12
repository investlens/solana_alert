import test from 'node:test';import assert from 'node:assert/strict';import {createConfirmedNormalDeliveryLookup} from '../src/services/confirmedOpportunityDelivery.js';import {readFileSync} from 'node:fs';
test('unconfirmed history is retryable, accepted delivery suppresses repeats and lookups coalesce',async()=>{
 let reads=0,now=0;const lookup=createConfirmedNormalDeliveryLookup(async()=>{reads++;return false;},()=>now);
 assert.deepEqual(await Promise.all([lookup('TOKEN'),lookup('token')]),[false,false]);assert.equal(reads,1);await lookup('token');assert.equal(reads,1);
 lookup.confirm('token');assert.equal(await lookup('token'),true);assert.equal(reads,1);now+=3600001;assert.equal(await lookup('token'),false);assert.equal(reads,2);
});
test('database failure stays unknown and never grants replay permission',async()=>{let reads=0;const lookup=createConfirmedNormalDeliveryLookup(async()=>{reads++;throw Error('timeout');});await assert.rejects(lookup('token'));await assert.rejects(lookup('token'));assert.equal(reads,2);});
test('a slow negative history read cannot overwrite a newly accepted delivery',async()=>{
 let resolve!:(confirmed:boolean)=>void;const lookup=createConfirmedNormalDeliveryLookup(()=>new Promise<boolean>(r=>{resolve=r;}));
 const pending=lookup('token');lookup.confirm('token');resolve(false);assert.equal(await pending,true);assert.equal(await lookup('token'),true);
});
test('independent dispatcher and confirmed-history dedup keep the recovery profile gated',()=>{
 const read=(p:string)=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
 assert.match(read('startup.ts'),/OPPORTUNITY_DELIVERY_ENABLED === 'true'\) startOpportunityDeliveryService/);
 const scanner=read('chains/robinhood/existingTokenOpportunityScanner.ts');assert.match(scanner,/qualified && prior.lastAlertAt \? await hasConfirmedNormalOpportunityDelivery/);assert.match(scanner,/result.transition \|\| prior.lastAlertAt/);
 assert.match(read('services/opportunityDeliveryService.ts'),/delivered>0.*hasConfirmedNormalOpportunityDelivery.confirm/);
});
