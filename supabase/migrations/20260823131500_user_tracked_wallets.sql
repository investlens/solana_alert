create table if not exists public.user_tracked_wallets (
  id bigserial primary key,

  telegram_id text not null,

  wallet_address text not null,

  chain text not null default 'solana',

  label text,

  is_active boolean not null default true,

  alerts_enabled boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint user_tracked_wallets_unique
    unique (
      telegram_id,
      chain,
      wallet_address
    )
);

create index if not exists
  user_tracked_wallets_telegram_idx
  on public.user_tracked_wallets(
    telegram_id
  );

create index if not exists
  user_tracked_wallets_active_idx
  on public.user_tracked_wallets(
    chain,
    is_active
  );

comment on table
  public.user_tracked_wallets
is
  'AlphaOS user-managed public wallet watchlist.';
