create table if not exists public.wallet_monitor_cursors (
  chain text not null,
  wallet_address text not null,
  last_processed_block bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain, wallet_address),
  constraint wallet_monitor_cursors_block_nonnegative check (last_processed_block >= 0)
);

create index if not exists wallet_monitor_cursors_chain_block_idx
  on public.wallet_monitor_cursors(chain, last_processed_block);

alter table public.wallet_monitor_cursors enable row level security;

comment on table public.wallet_monitor_cursors is
  'Service-owned restart-safe wallet polling checkpoints shared by network and public address; user delivery remains isolated in wallet_activity_deliveries.';

alter table public.wallet_activity_deliveries
  drop constraint if exists wallet_activity_type_check;

alter table public.wallet_activity_deliveries
  add constraint wallet_activity_type_check
  check (activity_type in ('BUY', 'SELL', 'LAUNCH', 'RECEIVE', 'SEND'));
