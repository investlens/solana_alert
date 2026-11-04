#!/usr/bin/env bash
# AlphaOS Echo: operator-only read-only export and INDEPENDENT LOCAL restore
# of the two PRE-EXISTING production Echo tables. No production DDL, no signer.
# This verifies Echo table recovery, NOT full Supabase recovery / auth / storage.
#
# Run on trusted workstation with Docker, PostgreSQL 17 client tools, and a
# private ENCRYPTED output disk. Do not run in public CI or inside Railway.
# Source connection via PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD,
# PGSSLMODE=require. No credentials printed or passed on command line.
set -euo pipefail
umask 077
: "${ECHO_RECOVERY_DIR:?Set ECHO_RECOVERY_DIR to an existing encrypted private directory}"
: "${ECHO_RECOVERY_ACK:?Set ECHO_RECOVERY_ACK=LOCAL_RESTORE_ONLY}"
[[ "$ECHO_RECOVERY_ACK" == "LOCAL_RESTORE_ONLY" ]] || { echo "INVALID_ACK" >&2; exit 2; }
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
export PGSSLMODE="${PGSSLMODE:-require}"
[[ "$PGSSLMODE" != "disable" ]] || { echo "PG_SSL_REQUIRED" >&2; exit 2; }
for cmd in pg_dump pg_restore psql docker sha256sum stat; do
 command -v "$cmd" >/dev/null || { echo "MISSING_TOOL:$cmd" >&2; exit 2; }
done
[[ -d "$ECHO_RECOVERY_DIR" && ! -L "$ECHO_RECOVERY_DIR" ]] || { echo "PRIVATE_OUTPUT_DIRECTORY_REQUIRED" >&2; exit 2; }
# 0700 only; fail rather than silently weaken permissions.
mode="$(stat -c %a "$ECHO_RECOVERY_DIR")"
[[ "$mode" == "700" ]] || { echo "OUTPUT_DIRECTORY_MUST_BE_0700" >&2; exit 2; }
[[ "$(pg_dump --version)" == *" 17."* ]] || { echo "PG_DUMP_17_REQUIRED" >&2; exit 2; }
[[ "$(pg_restore --version)" == *" 17."* ]] || { echo "PG_RESTORE_17_REQUIRED" >&2; exit 2; }
[[ "$(psql --version)" == *" 17."* ]] || { echo "PSQL_17_REQUIRED" >&2; exit 2; }
[[ "$PGHOST" != "localhost" && "$PGHOST" != "127.0.0.1" ]] ||
 { echo "SOURCE_MUST_BE_REMOTE_PRODUCTION" >&2; exit 2; }
[[ "${ECHO_EXPECTED_SOURCE_HOST:-}" == "$PGHOST" && -n "${ECHO_EXPECTED_SOURCE_HOST:-}" ]] ||
 { echo "EXACT_SOURCE_HOST_ATTESTATION_REQUIRED" >&2; exit 2; }
docker image inspect postgres:17 >/dev/null || { echo "PREPULL_POSTGRES_17_LOCALLY" >&2; exit 2; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$ECHO_RECOVERY_DIR/echo-pre-migration-$stamp"
mkdir -m 700 "$dest"
archive="$dest/echo-tables.dump"
name="echo-local-restore-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; }
trap cleanup EXIT
read_source(){
 psql -X -A -t -v ON_ERROR_STOP=1 -c "SELECT
 (SELECT count(*) FROM public.echo_live_buy_intents)::bigint::text
 ||'|'||
 (SELECT count(*) FROM public.echo_caller_alert_audit)::bigint::text;"
}
before="$(read_source)"
[[ "$before" =~ ^[0-9]+\|[0-9]+$ ]] || { echo "SOURCE_TABLES_UNREADABLE" >&2;exit 1; }
pg_dump --format=custom --no-owner --no-acl --table=public.echo_live_buy_intents \
 --table=public.echo_caller_alert_audit --file="$archive"
[[ -s "$archive" ]] || { echo "EMPTY_BACKUP" >&2;exit 1; }
chmod 600 "$archive"
pg_restore --list "$archive" > "$dest/archive-contents.txt"
sha256sum "$archive" > "$dest/archive.sha256"
(cd "$dest" && sha256sum --check --status archive.sha256) ||
 { echo "BACKUP_INTEGRITY_FAILED" >&2;exit 1; }
after="$(read_source)"
[[ "$before" == "$after" ]] ||
 { echo "SOURCE_CHANGED_DURING_BACKUP_RECHECK_AND_RETRY" >&2;exit 1; }
# Fresh, disconnected PostgreSQL container: no routes to production, no
# published ports, no persistent service, no cloud bill.
docker run -d --name "$name" --network none -e POSTGRES_PASSWORD=isolated-temporary-test \
 postgres:17 >/dev/null
ready=0
for _ in $(seq 1 40); do
 if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1;then ready=1;break;fi
 sleep 1
done
[[ "$ready" == 1 ]] || { echo "ISOLATED_POSTGRES_NOT_READY" >&2;exit 1; }
docker exec -i "$name" pg_restore -U postgres -d postgres --no-owner --no-acl \
 --exit-on-error < "$archive" >/dev/null
restored="$(docker exec "$name" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
 "SELECT (SELECT count(*) FROM public.echo_live_buy_intents)::text ||'|'||
 (SELECT count(*) FROM public.echo_caller_alert_audit)::text;")"
[[ "$restored" == "$before" ]] || { echo "RECOVERY_ROW_COUNT_MISMATCH" >&2;exit 1; }
identity="$(docker exec "$name" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
 "SELECT
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.echo_live_buy_intents'::regclass)::text||'|'||
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.echo_caller_alert_audit'::regclass)::text||'|'||
 (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.echo_live_buy_intents'::regclass AND contype='p' LIMIT 1);")"
[[ "$identity" == 'true|true|PRIMARY KEY (execution_wallet, mint)' ]] ||
 { echo "RECOVERY_RLS_OR_UNIQUE_CONSTRAINT_MISMATCH" >&2;exit 1; }
# Check restore backup is stored with secret-safe filesystem permissions.
[[ "$(stat -c %a "$archive")" == 600 ]] || { echo "ARCHIVE_PERMISSIONS_UNSAFE" >&2;exit 1; }
printf 'SOURCE_TABLE_COUNTS=%s\nARCHIVE_SHA256_FILE=archive.sha256\nRESTORE=INDEPENDENT_OFFLINE_LOCAL_CONTAINER\nRLS_AND_PKEY=PASS\nSCOPE=ECHO_TABLES_ONLY\nPRODUCTION_SCHEMA_UNCHANGED=true\n' "$restored" > "$dest/verification.txt"
chmod 600 "$dest/"*
echo "ECHO_REAL_TABLE_BACKUP_LOCAL_RESTORE=PASS;SCOPE=ECHO_TABLES_ONLY;FULL_SUPABASE_RECOVERY=NOT_VERIFIED"
echo "Private output directory retained locally; NEVER upload backups to GitHub or chat."
