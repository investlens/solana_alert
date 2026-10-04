# Non-Boost feed repair — 2026-10-04

## Protected paths

No changes to Boost or DEX Paid observer, eligibility, security, timing, dedup,
or delivery code. The existing trusted PONS V1/V2 and Flap policy is retained.
No new Railway service, database table, migration, image storage, or discovery
poller is introduced.

## Trade Setup Watch

- Observe admitted launches before 30 minutes; sending still requires age >=30m.
- Keep the 20-active/50-pending caps and ten observations per minute. Schedule by
  attempted read time so failed reads cannot monopolise the request budget.
- Provider gaps reset consecutive confirmations, not observed peaks/pullbacks.
- A graduated or unavailable curve may use an exact Robinhood/base-token DEX
  pair through the existing governed background-priority endpoint. Invalid or
  missing price/liquidity never becomes a zero or a confirmation.
- Reset all trend history when source or pool changes. ETH reserve ratios are
  never compared with USD prices. Checkpoint restoration retains source/pool.
- Re-read the same source/pool after enrichment and require price/depth not to
  deteriorate before claiming delivery. Preserve existing once-per-token dedup.
- Creator eligibility is unchanged: fresh complete transfer evidence and no
  other transfers, plus positive holding or confirmed burn. Missing/stale data
  is reported separately and retries after 60 seconds instead of five minutes.
- DEX cards use DEX MC/FDV separately, USD price/liquidity and USD invalidation;
  pre-bond cards retain ETH reserve labels. Existing shared stats enrichment is
  used at delivery. Values are not fabricated.

## Diagnostics / remaining limits

Aggregate screening counters share the existing per-worker health publication
(at most once/minute, one-hour Redis TTL); they contain no raw events, token
lists or user identities and perform no database writes. They distinguish data
unavailable, condition waiting, risk rejected and qualified from accepted sends.
Repeated checks are not unique-token counts.

PONS curve trend still rejects genuinely flat reserves; thresholds were not
lowered without evidence. Trade Setup now covers eligible graduated watches,
but a separate PONS Trend DEX continuation is not implemented in this patch.
Social Mafia retains author-attributed exact CA/chain confirmation and the
15-minute rechecks/one-hour expiry. Public X unreadability remains a source
limitation, not proof of a fake project. Protocol Discovery retains X+Telegram.
ARC is deployed from its separate branch and its sellability evidence coverage
remains unresolved; no shared ARC Boost security helper was changed. Burn and
creator alerts have not been proven by a new live qualifying event in this audit.

This patch does not guarantee profitable signals or prove every feed has had an
end-to-end live send. Telegram acceptance must be reported separately from
service uptime, event discovery, and qualification.
