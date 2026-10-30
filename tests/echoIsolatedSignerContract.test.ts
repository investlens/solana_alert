import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoSignerRequest,ECHO_SIGNER_ENABLED} from '../src/echo/isolatedSignerContract.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111112';
const good={executionWallet:wallet,mint,reservationKey:wallet+':'+mint,
 unsignedTransactionBase64:'A'.repeat(200),simulationVerified:true,
 destinationAndProgramsVerified:true,freshQuoteVerified:true};
test('isolated signer only permits vetted requests for expected public wallet',()=>{
 assert.deepEqual(reviewEchoSignerRequest(good),{ok:true,wallet});
 assert.equal(ECHO_SIGNER_ENABLED,false);
});
test('isolated signer denies wallet mismatch, stale validation and reservation mismatch',()=>{
 for(const overrides of [{executionWallet:'4'.repeat(44)},{reservationKey:'other'},
  {simulationVerified:false},{destinationAndProgramsVerified:false},
  {freshQuoteVerified:false},{unsignedTransactionBase64:'bad'}])
  assert.equal(reviewEchoSignerRequest({...good,...overrides}).ok,false);
});
