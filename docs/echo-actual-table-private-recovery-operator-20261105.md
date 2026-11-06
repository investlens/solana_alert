# AlphaOS Echo actual-data recovery gate — operator procedure

**Purpose:** Verify a private copy of the **existing Echo tables** from the pinned production Supabase database by restoring into a fully disconnected local PostgreSQL 17 Docker container. This supports, but does NOT itself clear, the requirement to prove recovery of the **entire** Supabase production database before any live migration.

## Prerequisites
- A trusted workstation with PostgreSQL **17** `pg_dump`, `pg_restore` and `psql`, Docker, `sha256sum`, Bash and an **encrypted** local drive.
- Download/pull `postgres:17` in advance. No cloud resources or subscriptions required.
- Use a credential with read-only access sufficient to dump the two tables. On Supabase, setting up this access or preparing a compatible dump account is an **operator action**; do not paste passwords, database URLs, dump files or access tokens in chat, CI or GitHub.
- A private output folder with permissions `0700`; free disk sufficient for the actual Echo data and snapshots; app alerts continue running.

## Secure local operation
The script deliberately requires `PGHOST=db.spwiqtdxfwjlqftujohm.supabase.co`, `PGDATABASE=postgres`; this prevents accidentally backing up some other project's table names. Set other PostgreSQL connection parameters via your local secret manager or environment, with `PGSSLMODE=require` or `verify-full`. The actual password must remain local.

Run from a trusted working copy of the reviewed repository:

```bash
mkdir -m 700 -p "$HOME/echo-recovery-private"
docker pull postgres:17                    # one-time local image download
export PGHOST=db.spwiqtdxfwjlqftujohm.supabase.co
export PGPORT=5432
export PGDATABASE=postgres
export PGSSLMODE=require
# Supply PGUSER and PGPASSWORD securely in your local environment.
export ECHO_RECOVERY_DIR="$HOME/echo-recovery-private"
export ECHO_RECOVERY_ACK=LOCAL_RESTORE_ONLY
bash scripts/echoPrivateTableBackupAndLocalRestore.sh
```

No terminal history, screenshots, chat or log uploads should include secrets or the archive. The script uses `pg_dump` to read **only** `public.echo_live_buy_intents` and `public.echo_caller_alert_audit`. It checks source counts immediately before/after the dump; if concurrent writes change counts, it fails for operator review. The output directory contains a chmod-0600 PostgreSQL custom archive, SHA-256 file, archive listing and verification result. Verify encrypted private storage; retain it until a reviewed archival or deletion policy exists.

A successful local run requires:
1. The pinned source is queried over an encrypted PostgreSQL connection.
2. A nonempty custom-format dump and SHA-256 validation.
3. An entirely **offline** local PostgreSQL 17 Docker restoration, with no network routes to source.
4. Matching source/restore counts for both Echo tables and verified RLS + `PRIMARY KEY (execution_wallet, mint)`.
5. A retained private backup artifact and timestamped recovery note **without any sensitive data copied into GitHub or chat**.

## Not yet covered by this two-table proof
- Full production Supabase recovery: all application and managed schemas, role/password restoration, RLS grants, extensions, triggers, functions, authentication, Storage API objects, and complete migration history. Supabase physical-backup restoration on the actual project is destructive and must NEVER be used for a test.
- Production backup freshness at the moment SQL changes are eventually authorized.
- Deployment or activation of the four missing Echo protections.
- Live SOL wallet, CPI cost, manual SELL reserve, signer or trading acceptance.

**Release decision:** Do not apply live database migrations just because the Echo table-only restore passes. A separate full-project, non-production recovery demonstration or explicitly reviewed equivalent assurance is still required. This is an operator-only script, never a CI job running production credentials.

## Current engineering validation
The existing synthetic PostgreSQL 17 tests already established 4-client contention, persistent capital and nonce protection across hard restart, and independent-container `pg_dump`/`pg_restore`. The production-specific script is also checked by CI with `bash -n` only (it must never connect to live Supabase from GitHub Actions). Neither synthetic data nor shell syntax checking counts as an actual production recovery.
