import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {walletIndexedRange} from '../src/chains/robinhood/robinhoodWalletWatcher.js';
test('wallet fallback scans bounded ranges without skipping outstanding blocks',()=>{assert.deepEqual(walletIndexedRange(100n,5000n),{fromBlock:101n,toBlock:1100n});assert.deepEqual(walletIndexedRange(100n,120n),{fromBlock:101n,toBlock:120n});});
test('production wiring directly invokes lean fallback, commits checkpoints, and isolates paused Solana',()=>{
 const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');assert.match(read('src/main.ts'),/await pollRobinhoodTrackedWalletsLean/);assert.doesNotMatch(read('src/productionStartup.ts'),/writeFile|replace\(/);assert.match(read('src/main.ts'),/SOLANA_ALERTS_PAUSED === 'true' \? \[\]/);assert.match(read('src/chains/robinhood/robinhoodWalletWatcher.ts'),/commitRobinhoodWalletCheckpoints\(advanced,range.toBlock\)/);
});
