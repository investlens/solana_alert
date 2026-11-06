#!/usr/bin/env bash
# Synthetic PostgreSQL 17 integration. NO production connection, real keys, or SOL.
set -euo pipefail
name="echo-five-dollar-disposable-$$"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --name "$name" --network none -e POSTGRES_PASSWORD=disposable-only postgres:17 >/dev/null
ready=0
for _ in $(seq 1 40);do
 if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1;then ready=1;break;fi
 sleep 1
done
[[ "$ready" == 1 ]] || { echo "POSTGRES_NOT_READY";exit 1; }
run(){ docker exec "$name" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"; }
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
 "create role anon; create role authenticated; create role service_role;" >/dev/null
for sql in docs/sql/echo-live-buy-intents.sql docs/sql/echo-pilot-atomic-two-slot.sql \
 docs/sql/echo-five-dollar-per-call-review-only.sql docs/sql/echo-five-dollar-one-shot-review-only.sql;do
 docker exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$sql" >/dev/null
done
wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'
mint='So11111111111111111111111111111111111111113'
sig1="$(printf '2%.0s' {1..64})"
sig2="$(printf '3%.0s' {1..64})"
sig3="$(printf '4%.0s' {1..64})"
tx1="$(printf '5%.0s' {1..64})"
tx2="$(printf '6%.0s' {1..64})"
sha="$(printf 'a%.0s' {1..64})"
finger="$(printf 'b%.0s' {1..64})"
reserve(){
 local sig="$1"
 run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$sig','$mint',
 20000000,50000,2000000,100000,2000000,20000,100000000,now());"
}
claim(){
 local sig="$1" tx="$2"
 run "select public.echo_claim_five_usd_submission_once(
 '$wallet','$caller','$sig','$mint','$tx','$sha','$finger');"
}
# Two independent concurrent SQL clients race on the SAME verified source.
# Exactly one may reserve. The other MUST fail as a durable duplicate.
reserve "$sig1" > "$tmp/race-a" &
a_pid=$!
reserve "$sig1" > "$tmp/race-b" &
b_pid=$!
wait "$a_pid"
wait "$b_pid"
race_a="$(cat "$tmp/race-a")"
race_b="$(cat "$tmp/race-b")"
if ! { [[ "$race_a" == RESERVED && "$race_b" == DUPLICATE_SOURCE_TRANSACTION ]] ||
       [[ "$race_b" == RESERVED && "$race_a" == DUPLICATE_SOURCE_TRANSACTION ]]; };then
 echo "CONCURRENT_SOURCE_DEDUP_FAILED";exit 1
fi
[[ "$(reserve "$sig1")" == DUPLICATE_SOURCE_TRANSACTION ]] ||
 { echo "REPLAY_NOT_REJECTED";exit 1; }
[[ "$(reserve "$sig2")" == RESERVED ]] || { echo "SAME_MINT_NEW_CALL_FAILED";exit 1; }
[[ "$(reserve "$sig3")" == TWO_ACTIVE_LOTS_LIMIT ]] ||
 { echo "TWO_LOTS_CAP_BYPASSED";exit 1; }
[[ "$(claim "$sig1" "$tx1")" == CLAIMED ]] || { echo "FIRST_ONESHOT_FAILED";exit 1; }
[[ "$(claim "$sig1" "$tx1")" == ALREADY_CLAIMED_OR_UNRESOLVED ]] ||
 { echo "ONESHOT_REPLAY_NOT_BLOCKED";exit 1; }
[[ "$(claim "$sig2" "$tx2")" == CLAIMED ]] || { echo "SECOND_ONESHOT_FAILED";exit 1; }
[[ "$(run "select state from public.echo_per_call_buy_intents where source_signature='$sig1';")" == unknown ]] ||
 { echo "UNKNOWN_OUTCOME_NOT_PRESERVED";exit 1; }
[[ "$(run "select count(*) from public.echo_per_call_buy_intents where mint='$mint';")" == 2 ]] ||
 { echo "TWO_DISTINCT_CALLS_NOT_STORED";exit 1; }
[[ "$(run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$sig3','So11111111111111111111111111111111111111114',
 24000000,50000,2000000,100000,2000000,20000,100000000,now());")" == FIVE_DOLLAR_ALL_IN_CAP ]] ||
 { echo "USD_CAP_NOT_ENFORCED";exit 1; }
acl="$(run "select
 has_table_privilege('anon','public.echo_per_call_buy_intents','INSERT'),
 has_table_privilege('authenticated','public.echo_per_call_buy_intents','SELECT'),
 has_function_privilege('anon','public.echo_reserve_five_usd_distinct_call(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_reserve_five_usd_distinct_call(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE');")"
[[ "$acl" == 'f|f|f|t' ]] || { echo "ROLE_GRANTS_UNSAFE";exit 1; }
[[ "$(run "select relrowsecurity from pg_class where oid='public.echo_per_call_buy_intents'::regclass;")" == t ]] ||
 { echo "RLS_NOT_ENABLED";exit 1; }
echo "ECHO_FIVE_USD_DISPOSABLE_PG17=PASS;CONCURRENT_SOURCE_REPLAY=BLOCKED;REPEAT_MINT=PASS;SOURCE_REPLAY=BLOCKED;TWO_LOTS=PASS;ONE_SHOT=PASS;USD_CAP=PASS;RLS_AND_ACL=PASS;BROADCAST=OFF"
DUPLICATE_SOURCE_TRANSACTION\nRESERVED' ]] ||
 { echo "CONCURRENT_SOURCE_DEDUP_FAILED";exit 1; }
[[ "$(reserve "$sig1")" == DUPLICATE_SOURCE_TRANSACTION ]] ||
 { echo "REPLAY_NOT_REJECTED";exit 1; }
[[ "$(reserve "$sig2")" == RESERVED ]] || { echo "SAME_MINT_NEW_CALL_FAILED";exit 1; }
[[ "$(reserve "$sig3")" == TWO_ACTIVE_LOTS_LIMIT ]] ||
 { echo "TWO_LOTS_CAP_BYPASSED";exit 1; }
[[ "$(claim "$sig1" "$tx1")" == CLAIMED ]] || { echo "FIRST_ONESHOT_FAILED";exit 1; }
[[ "$(claim "$sig1" "$tx1")" == ALREADY_CLAIMED_OR_UNRESOLVED ]] ||
 { echo "ONESHOT_REPLAY_NOT_BLOCKED";exit 1; }
[[ "$(claim "$sig2" "$tx2")" == CLAIMED ]] || { echo "SECOND_ONESHOT_FAILED";exit 1; }
[[ "$(run "select state from public.echo_per_call_buy_intents where source_signature='$sig1';")" == unknown ]] ||
 { echo "UNKNOWN_OUTCOME_NOT_PRESERVED";exit 1; }
[[ "$(run "select count(*) from public.echo_per_call_buy_intents where mint='$mint';")" == 2 ]] ||
 { echo "TWO_DISTINCT_CALLS_NOT_STORED";exit 1; }
[[ "$(run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$sig3','So11111111111111111111111111111111111111114',
 24000000,50000,2000000,100000,2000000,20000,100000000,now());")" == FIVE_DOLLAR_ALL_IN_CAP ]] ||
 { echo "USD_CAP_NOT_ENFORCED";exit 1; }
acl="$(run "select
 has_table_privilege('anon','public.echo_per_call_buy_intents','INSERT'),
 has_table_privilege('authenticated','public.echo_per_call_buy_intents','SELECT'),
 has_function_privilege('anon','public.echo_reserve_five_usd_distinct_call(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_reserve_five_usd_distinct_call(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE');")"
[[ "$acl" == 'f|f|f|t' ]] || { echo "ROLE_GRANTS_UNSAFE";exit 1; }
[[ "$(run "select relrowsecurity from pg_class where oid='public.echo_per_call_buy_intents'::regclass;")" == t ]] ||
 { echo "RLS_NOT_ENABLED";exit 1; }
echo "ECHO_FIVE_USD_DISPOSABLE_PG17=PASS;REPEAT_MINT=PASS;SOURCE_REPLAY=BLOCKED;TWO_LOTS=PASS;ONE_SHOT=PASS;USD_CAP=PASS;RLS_AND_ACL=PASS;BROADCAST=OFF"
