# Boost delivery and social verification safeguards

Robinchain BOOST attempts check the existing event-identity index for all three canonical titles at the same token/total. Accepted recovery audits, accepted boost markers, and durable delivered/sent-unconfirmed receipts suppress repeats. Before sending, an atomic Redis NX claim covers the chain/token/total for 30 days. Claims contain no user details, HTML or images; they expire automatically. Only security-qualified send attempts create claims. Higher totals have independent identities. No new database table or Railway service is created.

Database lookup or Redis uncertainty suppresses that attempt and backs off for one minute. After a claim succeeds, partial or ambiguous Telegram delivery is not replayed. This deliberately favors avoiding duplicate sends; a crash after claiming but before sending can miss that total. Accepted sends update the existing audit snapshot as a permanent backstop, best effort. If both that update and original recovery audit fail, the Redis protection lasts 30 days.

A Telegram acceptance callback prevents a ledger-completion error from triggering the runtime fallback. A normal zero-delivery result (security, preferences or existing reservation) also cannot trigger fallback.

Social Mafia still requires verified PONS origin, X and Telegram metadata links, and an authored X statement with the exact contract and explicit Robinchain context. Unavailable/unreadable X and failed metadata reads leave eligibility unknown rather than falsely rejecting the project. Neither permits a Social Mafia alert. Readable mismatches remain rejected. Protocol Discovery keeps its separately agreed unverified-social policy.

Social verification keeps at most 100 small verdicts in process memory, coalesces identical in-flight checks, limits concurrency to three and starts at most 20 checks/minute (each can fetch X and, following positive X proof, one Telegram preview). Unreadable/unavailable verdicts cool down for five minutes; readable verdicts for one minute. No fetched HTML is cached or written to the database. The existing 15/30/45/60-minute queue and one-hour expiration remain unchanged.

Public X pages often omit readable authored content. This change does not bypass access restrictions or guarantee CA proof. No X API, Telegram research API, proxy rotation or scraping escalation is introduced.
