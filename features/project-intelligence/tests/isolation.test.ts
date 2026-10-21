import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('importing the feature starts no workers, HTTP listeners, provider calls or Telegram polling',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected network');};
 try{const server=await import('../server.js');assert.equal(typeof server.start,'function');assert.equal(calls,0);}finally{globalThis.fetch=original;}
 for(const path of ['src/startup.ts','src/productionStartup.ts','package.json'])assert.doesNotMatch(readFileSync(new URL('../../../'+path,import.meta.url),'utf8'),/features\/project-intelligence/);
});
