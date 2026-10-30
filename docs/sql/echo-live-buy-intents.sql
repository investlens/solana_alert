-- Echo durable one-buy-per-token reservation. Apply only after review.
-- Both Slingoor and Chairman share the SAME (execution_wallet, mint) uniqueness boundary.
create table if not exists public.echo_live_buy_intents (
  execution_wallet text not null,
  mint text not null,
  caller_wallet text not null,
  source_signature text not null,
  amount_lamports bigint not null check (amount_lamports > 0 and amount_lamports <= 100000000),
  state text not null default 'reserved' check (state in ('reserved','signed','submitted','confirmed','failed_preflight','unknown','expired_unresolved')),
  transaction_signature text,
  signed_transaction_ciphertext text,
  last_valid_block_height bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (execution_wallet,mint),
  check (execution_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
-- Fail closed: only a trusted server-side service role may access the table.
alter table public.echo_live_buy_intents enable row level security;
revoke all on public.echo_live_buy_intents from anon, authenticated;
-- No user-facing RLS policies are created.
-- Never delete reservations automatically, even after a failed or unknown submission.
