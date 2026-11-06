# AlphaOS Echo — independent release-blocking security audit (2026-11-06)

**Scope:** PR #282 review-only $5 per independently verified caller BUY. This document records code-level safety controls and remaining evidence gaps. It is NOT a statement that auto-BUY is live, safe for unbounded funds or ready to deploy. Production was not altered.

## 1. Verified controls / evidence

- Encrypted Mac PostgreSQL 17.11 restore, isolated at 127.0.0.1:5434; two existing production Supabase tables recovered into encrypted storage. Local and contemporaneous production row counts 468 caller audits and zero legacy BUY intents; matching columns 13/11, both PK and RLS enabled. Dump excluded ACL grants; no cryptographic row-by-row comparison or complete disaster recovery proof.
- Disposable PostgreSQL 17 integration: unique source signature prevents replay; same token can be rebought on another genuine source signature; atomic advisory wallet lock serializes distinct calls, blocks oversubscription; $5 reservation with existing SELL reserve; pending/unknown debits remain reserved; one-shot submission claim and unknown outcome no retries; new table privileges deny anon/authenticated; an unreconciled legacy lot blocks.
- Trusted signer review requires cryptographically authenticated coordinator per-call identity, exact unsigned transaction SHA-256, immutable reserved row, numeric observed debit / FX / CPI proof and durable nonce. The new exact cost fields must match the reservation. PostgreSQL BIGINT decimals are parsed without rounding; lossy numbers rejected. Sign/broadcast permissions remain false.
- Public Coinbase/Kraken SOL/USD cross-check and official PumpSwap two-hop **unsigned** diagnostic passed read-only observation. Mainnet wallet 0 SOL, therefore no successful funded-state simulation, no CPI-proven debit, no live key signing, no trade. Latest approximate spot figure is only an observation, not a time-valid oracle.
- Railway production isolated custody proof says `ECHO_ISOLATED_CUSTODY=VERIFIED;TRADING=OFF`, on older branch. Not evidence that this new message was signed.

## 2. Critical release blockers (all FAIL CLOSED)

**A. No runnable trusted signer-side provenance adapter.**
`EchoTrustedPumpEvidenceReader` is currently an interface accepting abstract observation structs, and tests use synthetic values. There is no demonstrated production implementation fetching trusted raw RPC response data, recomputing complete account and CPI changes and independently authenticating the exact unsigned SDK-built bytes. Do not mistake a `true` flag (or spoofed mock) for independent provenance. Require pinned RPC and independently decoded protocol instruction/account owners, swap route, spending destinations, min output and CPI, plus fail-closed evidence of exact message bytes.

**B. Fee/debit proof not authoritative.**
Current simulated wallet debit audit uses `observed_before - simulated_after + reserved_rent + bounded_CPI`. This is conservative and can double-count costs already reflected in the simulated post-balance; it is not a full independently proven CPI allowance. Implement independently signed/parsed simulation capture and account deltas, bound fees/ATA creation/priority fee/inner CPI, then reconcile exact budget. No substitution of an arbitrary 1,000,000-lamport allowance.

**C. Manual Phantom SELL proof missing.**
Read-only full-exit verifier exists, but no actual Phantom SELL route, fees, reserve or observed original trade receipt is proven for this $5 pilot. No automatic SELL permitted. Account for manual exit reserve for all unclosed positions.

**D. Unfunded wallet.**
Mainnet public RPC read wallet as zero SOL; cannot simulate the exact genuine wallet transaction to successful completion. Do not suggest funding based on provisional `0.054629728 SOL` (historic diagnostic) or assumed CPI. Require final worst-case economics and separate owner funding approval, followed by bounded live-key signed/discarded exact transaction test.

**E. Real-world operator and production wiring incomplete.**
Review-only migration absent from production. Existing production admin/signer run older branches. No proved end-to-end source BUY -> isolated signer -> exactly-once submit and reconciled Telegram alert on current code, and no measured full 1–3s p95. Separate explicit permission required for migration/deployment and for a first real BUY, and then separately for unattended auto-BUY. Never silently deploy/restart old services.

## 3. Additional precautions / remaining audit checks

- Public price REST retrieval freshness is not exchange trade-tick freshness, does not authenticate data at a signed-oracle level; verify before releasing financial logic.
- Instruction allowlisting is NOT sufficient proof of benign swap destination accounts or PumpSwap CPI semantics; signer must require exact audited route and output mint.
- Existing unsigned diagnostic uses a single fixed route as a **diagnostic**; target-mint market cap and +50% call slippage/price gates cannot be inferred from this example.
- Verify actual service-role DB bigint mapping, transaction isolation/restart and concurrent caller loads in an end-to-end *isolated*, no-broadcast environment.
- Owner kill switch must fail closed across coordinator, nonce store, signer and broadcaster, not only UI.
- Preserve protected signing secret in isolated Railway service: never log, export, copy to GitHub, chat or test runners. Never use synthetic signing to claim real wallet key signability.
- Encrypt and independently back up restored DB evidence; 2-table encrypted local snapshot is not offsite disaster recovery.
- Verify alert timing separately from full follower RPC submission. No guaranteed 1–3 seconds on public RPC under congestion.

**Decision:** NOT READY FOR REAL-MONEY AUTO-BUY. Review branch may continue code/test work with signing and broadcast OFF. Do not deploy, change production SQL or wallet state without specific owner authorization.
