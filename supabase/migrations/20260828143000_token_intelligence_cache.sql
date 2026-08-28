-- Restart-safe cache for bounded, on-demand token intelligence enrichment.
create table if not exists public.token_intelligence_cache (
  chain text not null,
  token_address text not null,
  status text not null check (status in ('COMPLETE', 'PARTIAL', 'FAILED')),
  result jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (chain, token_address)
);

create index if not exists token_intelligence_cache_expiry_idx
  on public.token_intelligence_cache(expires_at);

alter table public.token_intelligence_cache enable row level security;
revoke all on table public.token_intelligence_cache from public, anon, authenticated, service_role;
grant select, insert, update on table public.token_intelligence_cache to service_role;

comment on table public.token_intelligence_cache is
  'Bounded on-demand intelligence cache. It does not control monitoring, delivery, or execution state.';
