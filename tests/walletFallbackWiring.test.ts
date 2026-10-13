import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {walletIndexedRange} from '../src/chains/robinhood/robinhoodWalletWatcher.js';
import {walletLiveRecoveryTarget} from '../src/chains/robinhood/robinhoodWalletWatcher.js';
test('live recovery preserves outstanding sends and bounded recent catch-up',()=>{
 assert.equal(walletLiveRecoveryTarget(100n,5000n,0),100n);
 assert.equal(walletLiveRecoveryTarget(100n,50000n,1),100n);
 assert.equal(walletLiveRecoveryTarget(100n,50000n,0),49000n);
 assert.equal(walletLiveRecoveryTarget(100n,50000n,0,40),49960n);
});
test('wallet fallback scans bounded ranges without skipping outstanding blocks',()=>{assert.deepEqual(walletIndexedRange(100n,5000n),{fromBlock:101n,toBlock:1100n});assert.deepEqual(walletIndexedRange(100n,120n),{fromBlock:101n,toBlock:120n});});
test('production wiring directly invokes lean fallback, commits checkpoints, and isolates paused Solana',()=>{
 const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');assert.match(read('src/main.ts'),/await pollRobinhoodTrackedWalletsLean/);assert.doesNotMatch(read('src/productionStartup.ts'),/writeFile|replace\(/);assert.match(read('src/main.ts'),/SOLANA_ALERTS_PAUSED === 'true' \? \[\]/);assert.match(read('src/chains/robinhood/robinhoodWalletWatcher.ts'),/commitRobinhoodWalletCheckpoints\(advanced,range.toBlock\)/);
});
