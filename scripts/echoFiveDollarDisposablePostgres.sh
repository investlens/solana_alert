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
for sql in docs/sql/echo-live-buy-intents.sql \
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
sig4="$(printf '7%.0s' {1..64})"
sig5="$(printf '8%.0s' {1..64})"
tx1="$(printf '5%.0s' {1..64})"
tx2="$(printf '6%.0s' {1..64})"
sha="$(printf 'a%.0s' {1..64})"
finger="$(printf 'b%.0s' {1..64})"
reserve(){
 local sig="$1" marketcap="${2:-45000}" balance="${3:-100000000}"
 run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$sig','$mint',
 20000000,50000,2000000,100000,2000000,20000,$balance,now(),$marketcap,now());"
}
claim(){
 local sig="$1" tx="$2"
 run "select public.echo_claim_five_usd_submission_once(
 '$wallet','$caller','$sig','$mint','$tx','$sha','$finger');"
}
# Wallet balance below $6 is not by itself a rejection; exact all-in cost
# and manual-exit reserve must fit before any commitment.
# Two DIFFERENT source signatures may race for one wallet with enough SOL
# for only ONE $5 all-in BUY plus its exit reserve. Advisory wallet locking
# must make the second reservation fail instead of oversubscribing balance.
race_sig_a="$(printf 'B%.0s' {1..64})"
race_sig_b="$(printf 'C%.0s' {1..64})"
reserve "$race_sig_a" 45000 2999990 > "$tmp/solvency-a" &
cash_a=$!
reserve "$race_sig_b" 45000 2999990 > "$tmp/solvency-b" &
cash_b=$!
wait "$cash_a"
wait "$cash_b"
cash_one="$(cat "$tmp/solvency-a")"
cash_two="$(cat "$tmp/solvency-b")"
if ! { [[ "$cash_one" == RESERVED &&
          "$cash_two" == INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE ]] ||
        [[ "$cash_two" == RESERVED &&
          "$cash_one" == INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE ]]; };then
 echo "CONCURRENT_DISTINCT_CALLS_OVERRAN_WALLET";exit 1
fi
[[ "$(run "select count(*) from public.echo_per_call_buy_intents
 where source_signature in ('$race_sig_a','$race_sig_b');")" == 1 ]] ||
 { echo "DISTINCT_CALL_BALANCE_SERIALIZATION_FAILED";exit 1; }
# Disposable PG only: reset the fixture before the existing scenario tests.
run "delete from public.echo_per_call_buy_intents
 where source_signature in ('$race_sig_a','$race_sig_b');" >/dev/null

# Two independent concurrent SQL clients race on the SAME verified source.
# Exactly one may reserve. The other MUST fail as a durable duplicate.
reserve "$sig1" 45000 2799999 > "$tmp/race-a" &
a_pid=$!
reserve "$sig1" 45000 30000000 > "$tmp/race-b" &
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
# No numerical position limit, but reserve all unsettled debits and exit fees.
[[ "$(reserve "$sig3" 45000 100000000)" == RESERVED ]] ||
 { echo "THIRD_DISTINCT_CALL_WRONGLY_BLOCKED";exit 1; }
[[ "$(reserve "$sig4" 99999 100000000)" == RESERVED ]] ||
 { echo "FOURTH_DISTINCT_CALL_WRONGLY_BLOCKED";exit 1; }
[[ "$(reserve "$sig5" 100000)" == INVALID_OR_STALE_ATTESTATION ]] ||
 { echo "MARKET_CAP_100K_NOT_REJECTED";exit 1; }
[[ "$(reserve "$sig5" 45000 100000000)" == INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE ]] ||
 { echo "FIFTH_CALL_OVERRAN_WALLET_AND_EXIT_RESERVES";exit 1; }
[[ "$(claim "$sig1" "$tx1")" == CLAIMED ]] || { echo "FIRST_ONESHOT_FAILED";exit 1; }
[[ "$(claim "$sig1" "$tx1")" == ALREADY_CLAIMED_OR_UNRESOLVED ]] ||
 { echo "ONESHOT_REPLAY_NOT_BLOCKED";exit 1; }
[[ "$(claim "$sig2" "$tx2")" == CLAIMED ]] || { echo "SECOND_ONESHOT_FAILED";exit 1; }
[[ "$(run "select state from public.echo_per_call_buy_intents where source_signature='$sig1';")" == unknown ]] ||
 { echo "UNKNOWN_OUTCOME_NOT_PRESERVED";exit 1; }
[[ "$(run "select count(*) from public.echo_per_call_buy_intents where mint='$mint';")" == 4 ]] ||
 { echo "FOUR_DISTINCT_CALLS_NOT_PERSISTED";exit 1; }
[[ "$(run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$sig3','So11111111111111111111111111111111111111114',
 24000000,50000,2000000,100000,2000000,20000,100000000,now(),45000,now());")" == FIVE_DOLLAR_ALL_IN_CAP ]] ||
 { echo "USD_CAP_NOT_ENFORCED";exit 1; }
# Model the ACTUAL production legacy schema (11 columns, no position_closed_at).
[[ "$(run "select count(*) from information_schema.columns where table_schema='public'
 and table_name='echo_live_buy_intents' and column_name='position_closed_at';")" == 0 ]] ||
 { echo "LEGACY_SCHEMA_FIXTURE_IS_NOT_PRODUCTION_SHAPE";exit 1; }
# Confirmed BUYs already affect on-chain balance: never double-count the
# original BUY debit, but retain its manual SELL reserve.
run "update public.echo_per_call_buy_intents set
 state='confirmed' where source_signature='$sig1';" >/dev/null
run "update public.echo_per_call_buy_intents set
 state='closed',position_closed_at=now() where source_signature='$sig2';" >/dev/null
# Existing confirmed position consumes one 2m SELL reserve, next call adds
# 22.15m BUY and 2m new exit; exact required wallet=26.15m.
[[ "$(reserve "$sig5" 45000 26150000)" == RESERVED ]] ||
 { echo "CONFIRMED_DEBIT_DOUBLE_COUNTED_OR_EXISTING_EXIT_RESERVE_WRONG";exit 1; }
[[ "$(run "select sum(sell_reserve_lamports) from public.echo_per_call_buy_intents
 where position_closed_at is null and state='confirmed';")" == 2000000 ]] ||
 { echo "CONFIRMED_EXIT_RESERVE_NOT_RETAINED";exit 1; }
# Close the newly created lot to isolate a direct wallet-solvency assertion
# from the independent maximum-two-position guard.
run "update public.echo_per_call_buy_intents set
 state='closed',position_closed_at=now() where source_signature='$sig5';" >/dev/null
sig6="$(printf '9%.0s' {1..64})"
[[ "$(run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$sig6','$mint',
 20000000,50000,2000000,100000,2000000,20000,26149999,now(),45000,now());")" == INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE ]] ||
 { echo "UNRESERVED_EXISTING_MANUAL_SELL_COST";exit 1; }
# Independent recovery must establish the outcome of ANY legacy intent.
run "insert into public.echo_live_buy_intents(
 execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state)
 values('$wallet','So11111111111111111111111111111111111111115','$caller','$sig6',
 20000000,'confirmed');" >/dev/null
[[ "$(run "select public.echo_reserve_five_usd_distinct_call(
 '$wallet','$caller','$(printf 'A%.0s' {1..64})','$mint',
 20000000,50000,2000000,100000,2000000,20000,100000000,now(),45000,now());")" == LEGACY_INTENTS_REQUIRE_RECONCILIATION ]] ||
 { echo "LEGACY_UNRECONCILED_POSITION_NOT_BLOCKED";exit 1; }
acl="$(run "select
 has_table_privilege('anon','public.echo_per_call_buy_intents','INSERT'),
 has_table_privilege('authenticated','public.echo_per_call_buy_intents','SELECT'),
 has_function_privilege('anon','public.echo_reserve_five_usd_distinct_call(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,bigint,timestamptz)','EXECUTE'),
 has_function_privilege('service_role','public.echo_reserve_five_usd_distinct_call(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,bigint,timestamptz)','EXECUTE');")"
[[ "$acl" == 'f|f|f|t' ]] || { echo "ROLE_GRANTS_UNSAFE";exit 1; }
[[ "$(run "select relrowsecurity from pg_class where oid='public.echo_per_call_buy_intents'::regclass;")" == t ]] ||
 { echo "RLS_NOT_ENABLED";exit 1; }
echo "ECHO_FIVE_USD_DISPOSABLE_PG17=PASS;CONCURRENT_SOURCE_REPLAY=BLOCKED;DISTINCT_SOURCE_WALLET_OVERSUBSCRIPTION=BLOCKED;REPEAT_MINT=PASS;SOURCE_REPLAY=BLOCKED;NO_POSITION_COUNT_CAP=PASS;MARKET_CAP_UNDER_100K=PASS;WALLET_BALANCE=ENFORCED;NO_ARBITRARY_MIN_BALANCE=PASS;ONE_SHOT=PASS;USD_CAP=PASS;LEGACY_SCHEMA_COMPATIBLE=PASS;CONFIRMED_DEBIT_NOT_DOUBLE_COUNTED=PASS;ALL_EXIT_RESERVES=PASS;RLS_AND_ACL=PASS;BROADCAST=OFF"
