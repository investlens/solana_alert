import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveManualEchoBuy } from '../src/echo/manualBuyReservation.js';
import { ECHO_EXPECTED_EXECUTION_WALLET } from '../src/echo/executionWallet.js';
import type { EchoReservationStore } from '../src/echo/paperReservation.js';
const input = {
 action:'BUY' as const, telegramUserId:'123',authorizedAdminId:'123',confirmationTokenVerified:true,
 executionWallet:ECHO_EXPECTED_EXECUTION_WALLET,mint:'So11111111111111111111111111111111111111112',
 amountSol:0.05,callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 sourceSignature:'1'.repeat(64),
};
test('manual intent reserves exact amount and prevents duplicate',async()=>{
 const rows:unknown[]=[];let inserted=false;
 const store:EchoReservationStore={async insertOnce(row){rows.push(row);if(inserted)return false;inserted=true;return true;}};
 assert.equal((await reserveManualEchoBuy(input,store)).reserved,true);
 assert.equal((await reserveManualEchoBuy(input,store)).reason,'DUPLICATE_TOKEN');
 assert.deepEqual(rows[0],{executionWallet:input.executionWallet,mint:input.mint,callerWallet:input.callerWallet,sourceSignature:input.sourceSignature,amountLamports:50_000_000});
});
test('invalid admin and storage outage fail closed',async()=>{
 const broken:EchoReservationStore={async insertOnce(){throw Error('database offline');}};
 assert.equal((await reserveManualEchoBuy(input,broken)).reason,'STORAGE_UNAVAILABLE');
 assert.equal((await reserveManualEchoBuy({...input,telegramUserId:'other'},broken)).reason,'UNAUTHORIZED_ADMIN');
});
