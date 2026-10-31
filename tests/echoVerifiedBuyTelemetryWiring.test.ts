import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Echo quicknode live classifier records verified BUY before Telegram network awaits',()=>{
 const source=readFileSync('scripts/runEchoQuicknode.ts','utf8');
 const start=source.indexOf('const queue = new EchoQueue');
 const end=source.indexOf('}, Date.now, config.statePath',start);
 assert.ok(start>=0&&end>start);
 const worker=source.slice(start,end);
 const classified=worker.indexOf('extractPumpAppRoutedEchoBuys(');
 const gate=worker.indexOf("if (signal.side !== 'BUY' || store.has(signal.id)) continue;");
 const record=worker.indexOf('echoShadowLatency.verifiedBuy({');
 const telegram=worker.indexOf("fetch(`https://api.telegram.org/bot");
 assert.ok(classified>=0&&gate>classified&&record>gate&&telegram>record,
  'Verified BUY telemetry must be after strict transaction classifiers and before Telegram delivery');
 assert.equal(worker.includes('echoShadowLatency.reserve'),false);
 assert.equal(worker.includes('submitEchoSignedTransaction('),false);
});
test('Echo live callback samples only accepted signature handoffs',()=>{
 const source=readFileSync('scripts/runEchoQuicknode.ts','utf8');
 const callback=source.slice(source.indexOf('const subscription = startEchoSubscription('),
  source.indexOf('const tick = setInterval('));
 assert.ok(callback.includes('const accepted=queue.add('));
 assert.ok(callback.includes('if (accepted) echoShadowLatency.websocketObserved(signature,wallet)'));
 assert.ok(!callback.includes('sendTransaction('));
});
