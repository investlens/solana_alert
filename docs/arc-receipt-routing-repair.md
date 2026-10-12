# ARC receipt-evidence routing

The ARC provider frequently returned `is_honeypot=0` and zero buy/sell taxes but omitted `cannot_sell_all`. The observation route was never reached because the preliminary provider result was false. A missing full-sell flag remains unknown; it is not manufactured as a pass.

For this specific incomplete-evidence case only, recent receipt-backed selling can now be evaluated. Provider honeypot screening must be affirmative, buy and sell taxes must be reported and at most 10%, and confirmed sell restrictions or excessive token taxes still block. Provider outages, absent honeypot evidence and missing tax data cannot enter this fallback.

The existing requirements remain: exact plain zero-hook pool identity, at least $2.5k liquidity, four recent distinct EOA sellers each receiving at least $5, at least $50 total proceeds, no seller over 60%, exact successful transaction/receipt/block identity and both net settlements. Known creator wallets are excluded. Linked funding/ownership remains unverified. Normal opportunity maturity, trend and market gates remain unchanged. Receipt evidence is not a full-size exit test or a guarantee.

Current launch candidates carry exact Initialize-event fee/tick/quote/hook metadata. That metadata now reaches both assessment and delivery, with mandatory pool-ID hash proof. This supports plain zero-fee or nonstandard-tick pools without guessing or waiving unknown hooks. Promotion pools without metadata still use a small exact-hash candidate set, including zero fees, and otherwise remain withheld.

Alerts disclose full-sell provider evidence unavailable and unverified LP protection. V4 position protection is never inferred from an unrelated ERC20 LP-holder list. Same-wallet ARC buy/full-sell simulation remains disabled pending independent real-pool validation. Receipt start rate, request caps and cache sizes are unchanged. Other chains are untouched by this ARC branch.
