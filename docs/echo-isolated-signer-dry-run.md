# AlphaOS Echo isolated signer and simulated BUY/SELL checkpoint

## Current deliverable
The dry-run suite in `tests/echoLocalIsolatedTradeModel.test.ts` generates
an **ephemeral in-memory test keypair** and verifies signer challenge-response.
It models two BUY positions at $10 each, enforces a third-BUY refusal, exercises
owner-only SELL 50% and SELL 100%, rejects stale balance/unauthorized SELL,
tests a BUY-only kill switch and checks a three-buy UTC-day cap.

**This is a local policy model, not a real swap simulation or production signer.**
It does not build a Pump.fun or Jupiter transaction, check actual pool liquidity,
call Solana RPC or broadcast. The fixture key has no funding and is discarded.

## Run in a clean developer checkout
```sh
npm ci --ignore-scripts
npx tsx --test tests/echoLocalIsolatedTradeModel.test.ts tests/echoIsolatedCustodyProbe.test.ts
npm run typecheck
```
The GitHub workflow also runs these tests. Do not claim success without observing
their results.

## Provisioning the production signer wallet (NOT DONE)
Do not export the existing Phantom wallet's seed to Railway or into any
ChatGPT prompt. Use a separately generated wallet in a protected signing
boundary. The production signer must:
1. Generate and retain the private key inside a separately controlled,
   access-restricted signing service/key store.
2. Report *only* its Solana public address. Never commit key, seed, or
   recovery phrase to GitHub or log outputs.
3. Prove custody with a fresh message challenge and enforce the expected
   public address in trusted configuration and durable DB policy.
4. Independently inspect the exact BUY/SELL transaction, fetch authoritative
   reservation state, and simulate before signing.
5. Persist signed signature and intent **before** any broadcast. Reconcile
   ambiguous outcomes; never automatically retry an uncertain transaction.
6. Enforce $10 per BUY, at most two pending/open positions ($20 total principal),
   one BUY per token lifetime, and three new BUYs per UTC day, using atomic DB state.
7. Keep trading and SELL broadcast hard-off during verification.
8. Allow manually authorized SELL independent of the automatic BUY kill switch,
   but retain all signing, balance, sell-route and owner checks.

The code currently pins the old verified Phantom address. A new signer address
will require a reviewed configuration and database policy update: never
silently direct deposits to a different wallet.

## Remaining blockers
- Choose and provision a secure signing service/key custody mechanism.
- End-to-end Jupiter/Pump.fun executable quote and instruction verification,
  full ALTs, writable account audit and independent on-chain simulation.
- Actual owner-authenticated Telegram SELL callback consumer.
- Apply reviewed atomic SQL migration to confirmed correct database.
- Real read-only RPC fixtures, integration tests, security audit and CI.
- Separate approval to fund the signer wallet and activate any transaction.

Production Echo admin watcher and original Solana bot remain unchanged.
