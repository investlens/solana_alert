# Holder access launch readiness

Public token section and fail-closed status endpoint are prepared. Holder membership
is NOT implemented or enabled. This does not establish security review completion.

## Publish the official contract

After independently confirming the token and chain, set `ALPHAOS_TOKEN_ADDRESS`
on the existing website Railway service and redeploy. This updates the contract
display only. Do not set a fake or example address in production.

The proposed threshold is 1,000,000 whole tokens, one Holder Pro tier. Publish final
benefits, limits, privacy terms and eligibility rules before activation.

## Required before enabling holder membership

- Server-validated Telegram identity; never trust a client-provided Telegram ID.
- Domain-, chain- and account-bound ownership message, random nonce, short expiry,
  atomic single-use consumption, CSRF/origin protection and distributed rate limits.
- Audited signature verification library; no transactions, approvals or deposits.
- Exact deployed contract/chain and validated token decimals; integer balance math.
- Private, unique wallet/account links and server-side membership enforcement for
  both premium tools and existing Telegram delivery, preserving paid/admin access.
- Bounded RPC balance caching, periodic rechecks and documented outage grace.
- Tests for replay, cross-account linking, cross-domain/chain signatures, transferred
  holdings, RPC failures, duplicate wallet links and concurrent requests.
- Independent security review and a controlled end-to-end test before activation.

Do not equate setting the contract environment variable with enabling membership.
No extra worker, Railway project, image storage or polling is created by this change.
