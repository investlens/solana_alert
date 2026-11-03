#!/usr/bin/env bash
# TEMPORARY disposable Postgres integration proof: never connects to Supabase.
# Requires local Docker. All data deleted on exit. No keys or live trading.
set -euo pipefail
name="echo-pilot-pg-${GITHUB_RUN_ID:-local}"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=echo-disposable-only postgres:17 >/dev/null
ready=0
for _ in $(seq 1 35); do
 if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1;break;fi
 sleep 1
done
[ "$ready" -eq 1 ] || { echo "POSTGRES_NOT_READY";exit 1; }
sql(){ docker exec "$name" psql -X -v ON_ERROR_STOP=1 -A -t -U postgres -d postgres -c "$1"; }
sql "create role anon; create role authenticated; create role service_role;" >/dev/null
for file in docs/sql/echo-live-buy-intents.sql docs/sql/echo-pilot-atomic-two-slot.sql docs/sql/echo-pilot-all-in-atomic.sql docs/sql/echo-pilot-one-shot-submission.sql docs/sql/echo-signer-nonce-replay-journal.sql; do
 docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$file" >/dev/null
done
wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'
sig="$(printf '3%.0s' {1..64})"
sha="$(printf 'a%.0s' {1..64})"
finger="$(printf 'b%.0s' {1..64})"
nonce="$(printf 'c%.0s' {1..64})"
mint_for(){ printf '%0.s%s' {1..44} "$1"; }
reserve(){
 local mint
 mint="$(printf "%44s" "" | tr ' ' "$1")"
 sql "select public.echo_pilot_reserve_all_in_atomic('$wallet','$mint','$caller','$sig',25000000,500,20000,500,100,3500,now());"
}
# Four real concurrent PostgreSQL sessions (each docker exec starts a distinct psql).
pids=()
for n in 4 5 6 7; do (reserve "$n" > "$tmp/$n") & pids+=("$!"); done
for pid in "${pids[@]}"; do wait "$pid"; done
[ "$(grep -l '^RESERVED$' "$tmp"/[4567] | wc -l | tr -d ' ')" -eq 2 ] || { echo "EXPECTED_EXACTLY_TWO_RESERVATIONS";exit 1; }
[ "$(grep -l '^TWO_SLOTS_FULL$' "$tmp"/[4567] | wc -l | tr -d ' ')" -eq 2 ] || { echo "EXPECTED_TWO_SLOT_DENIALS";exit 1; }
[ "$(sql "select committed_cents from public.echo_pilot_capital_ledger where execution_wallet='$wallet';")" = 2000 ] || exit 1
chosen="$(sql "select mint from public.echo_live_buy_intents order by mint limit 1;")"
claim(){ sql "select public.echo_pilot_claim_submission_once('$wallet','$chosen','$1','$sha','$finger',1000000);"; }
sig8="$(printf '8%.0s' {1..64})";sig9="$(printf '9%.0s' {1..64})"
claim "$sig8" > "$tmp/claim1" & a=$!
claim "$sig9" > "$tmp/claim2" & b=$!
wait "$a";wait "$b"
[ "$(grep -l '^CLAIMED$' "$tmp"/claim? | wc -l | tr -d ' ')" -eq 1 ] || exit 1
[ "$(grep -l '^ALREADY_CLAIMED_OR_NOT_RESERVED$' "$tmp"/claim? | wc -l | tr -d ' ')" -eq 1 ] || exit 1
[ "$(sql "select public.echo_signer_consume_nonce('$nonce',now()+interval '20 seconds');")" = t ] || exit 1
[ "$(sql "select public.echo_signer_consume_nonce('$nonce',now()+interval '20 seconds');")" = f ] || exit 1
# Validate ACL and retired bypass on the actual PostgreSQL server.
acl="$(sql "select
 has_function_privilege('anon','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_pilot_reserve_atomic(text,text,text,text,bigint)','EXECUTE');")"
[ "$acl" = 'f|t|f' ] || { echo "WRONG_DATABASE_ACL:$acl";exit 1; }
docker restart "$name" >/dev/null
ready=0
for _ in $(seq 1 35); do
 if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1;break;fi
 sleep 1
done
[ "$ready" -eq 1 ] || exit 1
[ "$(sql "select state from public.echo_live_buy_intents where execution_wallet='$wallet' and mint='$chosen';")" = unknown ] || exit 1
[ "$(sql "select committed_cents from public.echo_pilot_capital_ledger where execution_wallet='$wallet';")" = 2000 ] || exit 1
[ "$(sql "select public.echo_signer_consume_nonce('$nonce',now()+interval '20 seconds');")" = f ] || exit 1
[ "$(claim "$sig8")" = ALREADY_CLAIMED_OR_NOT_RESERVED ] || exit 1
[ "$(reserve 8)" = TWO_SLOTS_FULL ] || exit 1
# Validate actual pg_dump/pg_restore recovery of a populated synthetic pilot
# schema into a NEW database. No Supabase connection or production data.
# pg_dump runs against the initialized disposable PostgreSQL container.
docker exec "$name" pg_dump -U postgres -d postgres \
 --schema=public --format=custom --no-owner > "$tmp/echo-test-backup.dump"
[ -s "$tmp/echo-test-backup.dump" ] || { echo "SYNTHETIC_BACKUP_EMPTY"; exit 1; }
docker exec "$name" createdb -U postgres echo_restored
docker exec -i "$name" pg_restore -U postgres --dbname=echo_restored \
 --clean --if-exists --no-owner --exit-on-error < "$tmp/echo-test-backup.dump" >/dev/null
restored(){ docker exec "$name" psql -X -v ON_ERROR_STOP=1 -A -t -U postgres -d echo_restored -c "$1"; }
[ "$(restored "select count(*) from public.echo_live_buy_intents;")" = 2 ] || { echo "RESTORE_BUY_INTENTS_MISSING";exit 1; }
[ "$(restored "select state from public.echo_live_buy_intents where execution_wallet='$wallet' and mint='$chosen';")" = unknown ] || { echo "RESTORE_UNKNOWN_SUBMISSION_UNLOCKED";exit 1; }
[ "$(restored "select committed_cents from public.echo_pilot_capital_ledger where execution_wallet='$wallet';")" = 2000 ] || { echo "RESTORE_CAPITAL_LEDGER_MISMATCH";exit 1; }
[ "$(restored "select count(*) from public.echo_signer_used_nonces where nonce_hex='$nonce';")" = 1 ] || { echo "RESTORE_NONCE_JOURNAL_MISSING";exit 1; }
[ "$(restored "select relrowsecurity from pg_catalog.pg_class where oid='public.echo_live_buy_intents'::regclass;")" = t ] || { echo "RESTORE_RLS_DISABLED";exit 1; }
acl_restore="$(restored "select
 has_function_privilege('anon','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_pilot_reserve_atomic(text,text,text,text,bigint)','EXECUTE');")"
[ "$acl_restore" = 'f|t|f' ] || { echo "RESTORE_FUNCTION_GRANTS_MISMATCH";exit 1; }
[ "$(restored "select public.echo_signer_consume_nonce('$nonce',now()+interval '20 seconds');")" = f ] || { echo "RESTORE_NONCE_REUSE";exit 1; }
[ "$(restored "select public.echo_pilot_claim_submission_once('$wallet','$chosen','$sig8','$sha','$finger',1000000);")" = ALREADY_CLAIMED_OR_NOT_RESERVED ] || { echo "RESTORE_DOUBLE_SUBMISSION_POSSIBLE";exit 1; }
echo "ECHO_DISPOSABLE_BACKUP_RESTORE=PASS;NEW_DATABASE=echo_restored;RLS_AND_GRANTS=PASS;CAPITAL_AND_NONCE=PASS"
echo "ECHO_DISPOSABLE_POSTGRES=PASS;CONCURRENT_CLIENTS=4;PERSISTENCE=PASS;REPLAY=BLOCKED;BROADCAST=OFF"
