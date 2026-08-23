create table if not exists public.wallet_activity_deliveries (
  id bigserial primary key,

  telegram_id text not null,

  wallet_address text not null,

  transaction_signature text not null,

  activity_type text not null,

  token_address text,

  delivered_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  metadata jsonb not null default '{}'::jsonb,

  constraint wallet_activity_deliveries_unique
    unique (
      telegram_id,
      wallet_address,
      transaction_signature
    ),

  constraint wallet_activity_type_check
    check (
      activity_type in (
        'BUY',
        'SELL',
        'LAUNCH'
      )
    )
);

create index if not exists
  wallet_activity_deliveries_wallet_idx
  on public.wallet_activity_deliveries(
    wallet_address
  );

create index if not exists
  wallet_activity_deliveries_telegram_idx
  on public.wallet_activity_deliveries(
    telegram_id
  );

comment on table
  public.wallet_activity_deliveries
is
  'AlphaOS per-user tracked-wallet activity delivery deduplication.';
