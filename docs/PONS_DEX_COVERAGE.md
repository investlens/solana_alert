# Bounded PONS DEX coverage

The dedicated PONS worker uses its existing minute loop to verify retained tokens
and bounded prior-launch batches from returning developers. It sends no Telegram
messages. Existing Boost, DEX Paid, security checks and recipient timing are unchanged.

## Work budget

- At most two token verifications per minute across replicas, using a shared Redis claim.
- One token at a time, with an eight-second operation deadline.
- Candidate reads at most once per ten minutes: up to 160 existing compact outcome
  records plus one creator's next 32 indexed prior launches; at most 192 candidates.
- Creator hints are capped at 20. They come from already-observed verified PONS launches.
- Unknown checks cool down for one hour. A compact 200-entry attempt checkpoint
  survives restarts for seven days; a failed checkpoint prevents provider work.
- Known successful tokens are excluded on refresh. No census-wide provider scan,
  transaction history download, new service, or new database table is introduced.
- Database governor admission and transport priority remain background. Unavailable
  database/Redis/provider capacity defers research without delaying live discovery.
- `PONS_DEX_COVERAGE_ENABLED=false` disables only this optional research.

## Evidence

Match the approved factory/version/start block, exact token and indexed creator.
V2 also matches the page's curve to the indexed curve, confirms `token()` and
`graduated()` on that curve, then matches the official mapped pool to a usable
same-token Robinhood market. V1 uses its independent exact-token official mapping.
DEX payments, generic pools, price rises and website claims alone never count.

Store only the existing `alpha_pons_dex_reached` evidence shape: chain, token,
creator, factory, official pool, source and observation timestamp. The observation
is dated when verification occurs, never retroactively assigned a launch or
payment date. This cannot retroactively qualify a launch preceding that observation.

## Meaning and limits

This is progressive coverage, not a claim that all historical launches were checked.
The 30% numerator includes only persisted official-pool evidence; the denominator
still includes all indexed prior launches. Missing checks never increase success.
The current census can omit older factories or launches; cards disclose incomplete
indexed history. New proofs benefit future launches once they precede the launch.

`[PonsDexCoverage]` reports candidate/checked/verified/inserted/unverified counts.
`verified` is provider evidence; `inserted` is the database acknowledgement.
A database deferral or zero positive proofs is never reported as a successful
historical backfill. Existing live alert metrics remain separate.
