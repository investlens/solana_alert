import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverPonsProvenDeveloperTelegram, describePonsTelegramError } from '../src/chains/robinhood/ponsProvenDeveloperTelegram.js';
import type { PonsProvenDeveloperAlert } from '../src/chains/robinhood/ponsProvenDeveloperAlert.js';

const alert: PonsProvenDeveloperAlert = {
  kind: 'PONS_PROVEN_DEV_LAUNCH', priority: 'HIGH',
  launchIdentity: 'robinhood:0xfactory:0xtx:1', tokenAddress: '0xtoken',
  developerAddress: '0xdeveloper', developerTier: 'GEM', text: 'alert',
};

test('Pons Telegram delivery uses the existing durable semantic delivery contract',async()=>{let sent=0;const delivered=new Set<string>();const persist=async(args:any)=>{assert.equal(args.identity,alert.launchIdentity);assert.equal(args.intelligenceState,'CONFIRMED');assert.equal(args.rawSnapshot.autoBuyEnabled,false);return{id:7,event_identity:`v2:PONS_PROVEN_DEV_LAUNCH:${args.identity}`}};const deliver=async(args:any)=>{assert.equal(args.preserveMessage,true);assert.match(args.buttons[0][0].url,/dexscreener/);if(delivered.has(args.event.eventIdentity))return{delivered:0,failed:0};delivered.add(args.event.eventIdentity);sent++;return{delivered:1,failed:0}};await deliverPonsProvenDeveloperTelegram(alert,{persist:persist as never,deliver:deliver as never});await deliverPonsProvenDeveloperTelegram(alert,{persist:persist as never,deliver:deliver as never});assert.equal(sent,1)});

test('failed Telegram delivery remains retryable and a later success is deduplicated',async()=>{let attempts=0,delivered=false;const persist=async()=>({id:7,event_identity:'v2:PONS_PROVEN_DEV_LAUNCH:stable'});const deliver=async(args:any)=>{attempts++;if(attempts===1){args.onFailure({status:400,description:'Bad Request: chat not found'});return{delivered:0,failed:1}}if(delivered)return{delivered:0,failed:0};delivered=true;return{delivered:1,failed:0}};await assert.rejects(deliverPonsProvenDeveloperTelegram(alert,{persist:persist as never,deliver:deliver as never}),/code=400.*chat not found/);assert.deepEqual(await deliverPonsProvenDeveloperTelegram(alert,{persist:persist as never,deliver:deliver as never}),{delivered:1,failed:0});assert.deepEqual(await deliverPonsProvenDeveloperTelegram(alert,{persist:persist as never,deliver:deliver as never}),{delivered:0,failed:0});assert.equal(attempts,3)});

test('Telegram API and network errors expose safe diagnostics without secrets',()=>{const secret='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_secret';for(const failure of [{status:401,description:'Unauthorized '+secret},{error_code:403,description:'Forbidden: bot was blocked by the user'},new TypeError('fetch failed '+secret)]){const text=describePonsTelegramError(failure);assert.doesNotMatch(text,new RegExp(secret));assert.match(text,/description=/)}assert.match(describePonsTelegramError({code:'23514',message:'violates check constraint alpha_alert_events_intelligence_state_check'}),/code=23514.*check constraint/)});

test('Pons Telegram payload contains no trade execution capability',()=>{assert.deepEqual(Object.keys(alert).sort(),['developerAddress','developerTier','kind','launchIdentity','priority','text','tokenAddress']);assert.equal('trade' in alert,false);assert.equal('sign' in alert,false)});
