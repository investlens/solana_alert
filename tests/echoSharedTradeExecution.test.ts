import test from 'node:test';
import assert from 'node:assert/strict';
import {manualSellReleasesBuySlot,screenEchoExecutionEvidence} from '../src/echo/sharedTradeExecution.js';
const verified={soldPercent:100 as const,transactionConfirmed:true,balanceZeroVerified:true,proceedsVerified:true,sellSignaturePersisted:true};
test('only a verified complete sale releases capacity',()=>{
 assert.equal(manualSellReleasesBuySlot(verified),true);
 assert.equal(manualSellReleasesBuySlot({...verified,soldPercent:50}),false);
 for(const field of ['transactionConfirmed','balanceZeroVerified','proceedsVerified','sellSignaturePersisted'] as const)
  assert.equal(manualSellReleasesBuySlot({...verified,[field]:false}),false);
});
test('manual SELL requires durable reservation before any execution',()=>{
 const request={side:'SELL' as const,wallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
  mint:'So11111111111111111111111111111111111111112',reservationKey:'unknown',
  positionReservedInDatabase:false,signerVerifiedFromIsolatedWorker:false,onChainSimulationIndependentlyVerified:false,
  unsigned:{executionWallet:'',mint:'',reservationKey:'',unsignedTransactionBase64:'',simulationVerified:false,destinationAndProgramsVerified:false,freshQuoteVerified:false}};
 assert.deepEqual(screenEchoExecutionEvidence(request),{allowed:false,reason:'ATOMIC_RESERVATION_REQUIRED'});
});
