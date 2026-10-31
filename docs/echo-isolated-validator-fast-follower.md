# AlphaOS Echo: isolated validator and fast-follower acceptance

## Scope and safety

**No mainnet trades, no production deploy, no real wallet funds, no signer
provisioning.** The steps below are for development and controlled experiments,
and do not authorize signing on mainnet.

Solana test validator must be installed separately. It was not installed in
the ChatGPT execution environment as of this change.

## 1. Local validator smoke

Start an isolated Solana test validator in a separate terminal, with an empty
ledger directory. Keep port 8899 bound to loopback. Consult the installed
Solana CLI version for its local-validator flags. Never point the script at
mainnet or replace its hardcoded `127.0.0.1:8899` endpoint.

Then, from this Echo branch:

```sh
npm ci --ignore-scripts
npx tsx scripts/echoIsolatedValidatorSmoke.ts
```

The smoke script creates **ephemeral test-only keypairs**, requests valueless
test-validator SOL, builds an unsigned v0 test transaction and simulates it.
It performs no swap and no live broadcast. Failure to connect means the
validator isn't running or isn't reachable on the loopback port.

**Not yet proven:** SPL token mint/accounts, Pump.fun swap programs, Jupiter
unsigned BUY/SELL outputs, dynamic slippage, destination balances,
transaction rent and network fees. This smoke probe is a prerequisite for
further controlled account-fixture testing, not swap acceptance.

## 2. Fast follower: caller BUY to OUR BUY

- Consume the newest Slingoor/Chairman transaction from the existing websocket.
  Avoid slow repeated historical scans and duplicate RPC calls.
- Independently verify the caller was a signer, the transaction succeeded,
  input was spent and the target mint's tokens were credited. A transfer/gift
  must never trigger a BUY.
- Quote promptly in parallel with independent verification when possible, but
  never reserve or submit until the caller BUY is genuinely verified.
- Gate the same mint against the caller's **effective on-chain price**
  (actual swapped SOL input / raw tokens obtained) using integer ratios.
- Requote or **skip** if the caller BUY is older than 5 seconds, the quote is
  older than 1.2 seconds, expected price is over 3% above caller entry, or
  quoted slippage exceeds 3%. These are initial safety thresholds and must be
  measured against real end-to-end websocket latency.
- Independently size the order at $10 from fresh SOL/USD price, never exceeding
  0.1 SOL. Separately account for priority/network fees and rent.
- Make one atomic database reservation per execution wallet + token and
  enforce no rebuys, two occupied slots, three daily BUYs and loss kill switch.
- Any later signing service must freshly check maximum input, minimum output,
  token destinations, quote expiry, allowed programs, fee payer and fee budget.
- Notify Telegram **after** the admission decision; do not block on an alert
  send before deciding whether a BUY is eligible.
- An unknown submission MUST reconcile from signature/chain proof and never
  be retried as a fresh BUY.

**Important:** competing searchers/bots may see the same transaction first.
There is no guarantee of execution priority or matching the caller's price.
Skipping a stale/high-price trade is preferable to blindly chasing it.

This is a **shadow policy today**, not integrated permission to buy and not
a measured latency result. Real BUY and manual SELL remain OFF until complete
provider-backed and signer-side acceptance.
