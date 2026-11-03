# Echo production database recovery gate — NO MIGRATION AUTHORIZED

**Status: blocked until an actual backup artifact and a successful independent restore are verified.** This file is a runbook, not evidence that a backup exists. No production secrets, exports or credentials may be committed to GitHub or pasted into chat.

## Current observed production facts
- Project: `spwiqtdxfwjlqftujohm`, PostgreSQL 17; base `public.echo_live_buy_intents` exists with unique wallet/mint key, with zero existing BUY intents at last read.
- The all-in capital ledger, nonce journal, fee-inclusive reservation RPC and one-shot claim RPC remain absent.
- Disposable PostgreSQL tests passed for four real concurrent database clients and persistence across database restart, **not production**.
- Connected Supabase actions do not list or download backups, nor do they establish that a restore has succeeded. `restore_project` resumes a paused project and must NOT be confused with a database backup restore.

## Backup gate (operator-controlled, outside this repository)
1. Check **Supabase Dashboard > Database > Backups** for the production project's actual plan-specific backup and recovery point. Paid daily backups and PITR have different recovery windows. Do not assume automatic backup is enabled. Record backup ID, completed timestamp, recoverability and expected downtime in a private operational record.
2. If needed, take an encrypted, access-restricted **full logical backup** on a trusted machine using current official CLI instructions. Export roles, schema, data, and if required the migration history and custom changes in managed schemas; verify files exist, sizes and hashes. Do **not** share data exports, database URL, passwords or tokens in issue/PR comments.
3. Test restoration in a **separate isolated database/environment** and inspect key application tables, ownership, role grants, row counts, RLS and essential functions. Do not restore on production as a test and do not incur new services/paid branches without operator approval.
4. Capture a timestamped pre-migration production schema/constraint manifest and baseline counts. Confirm test restore reproduces it and the restoration procedure is documented.
5. Only after review/approval, apply migrations in dependency order in a controlled maintenance window: base intent table already present, atomic two-slot, all-in ledger, one-shot submission, persistent signer nonces.
6. Immediately test production RLS and service-only grants, one unique token reservation, budget and concurrency under strict safeguards. Real orders must remain OFF throughout. Confirm no legacy principal-only reservation bypass.

**Stop criteria:** unknown backup provenance, backup age outside recovery objective, no verified restore, failing integrity checks, incompatible grants, missing required data or conflicts in production constraints => **NO DDL / NO LIVE EXECUTION**.

Official references:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/reference/cli/introduction

## Exact wallet debit and SELL reserve evidence still required
Read-only latest historical two-hop 0.025 SOL quote found 5,000 lamports network fee, two missing ATAs and a provisional **36,709,320 lamports** total. This is NOT a funding amount or a complete swap debit ceiling: CPI wallet debits, pool-specific account effects, possible refund/rent, and independently measured manual SELL fee/rent remain unknown. A different live eligible mint or changed priority fee will yield a different cost envelope.

Strict code acceptance must fail closed unless:
- exact decoded instructions, payer and expected transfer source/amount are independently verified;
- every wallet-funded CPI debit and rent is identified without double-counting transfer principal;
- fee incl. priority is calculated for the exact transaction message;
- future full manual SELL route and fee + rent reserve is demonstrably available;
- current wallet balance, market-cap eligibility, token price and SOL/USD are verified;
- $10 all-in single order and $30 gross lifetime cap hold;
- separately validated real-wallet simulation succeeds and authorized signer test is completed with broadcast OFF.

No funding instruction, production DDL, signer access, broadcasting or enabling real trading is authorized by this document.
