create table if not exists public.wallet_intelligence_analyses (
  chain text not null,
  wallet_address text not null,
  status text not null,
  from_block bigint not null,
  to_block bigint not null,
  result jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz not null default now(),
  primary key (chain, wallet_address),
  constraint wallet_intelligence_analysis_status_check check (status in ('COMPLETE', 'FAILED'))
);

alter table public.wallet_intelligence_analyses enable row level security;

comment on table public.wallet_intelligence_analyses is
  'Bounded read-only historical wallet investigation coverage and verified evidence cache; never drives alerts, cursors, or trading.';
