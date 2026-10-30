-- AlphaOS Echo read-only operations archive. NOT a trade ledger.
-- Apply to verified AlphaOS Supabase project only after review; deployment
-- leaves this optional and disabled until explicit Echo audit credentials exist.
create table if not exists public.echo_caller_alert_audit (
  signature text not null,
  caller_wallet text not null,
  mint text not null,
  side text not null default 'BUY' check (side = 'BUY'),
  caller_label text not null,
  trade_at timestamptz not null,
  accepted_at timestamptz not null,
  telegram_message_id bigint not null check (telegram_message_id > 0),
  quote_amount numeric,
  quote_symbol text,
  quote_basis text,
  token_amount numeric,
  created_at timestamptz not null default now(),
  primary key (signature, caller_wallet, mint, side),
  constraint echo_caller_audit_sig_format check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  constraint echo_caller_audit_wallet_format check (caller_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  constraint echo_caller_audit_mint_format check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
create index if not exists echo_caller_audit_recent on public.echo_caller_alert_audit(caller_wallet,accepted_at desc);
alter table public.echo_caller_alert_audit enable row level security;
revoke all on public.echo_caller_alert_audit from anon, authenticated;
grant select, insert on public.echo_caller_alert_audit to service_role;
comment on table public.echo_caller_alert_audit is
  'AlphaOS Echo optional idempotent accepted Telegram caller BUY audit. Never controls delivery dedup, queues, trading, or wallet signing.';
