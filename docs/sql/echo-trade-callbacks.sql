-- Echo one-time Telegram callback tokens; review and apply only in staging first.
-- Store only SHA-256 token digests, never raw callback tokens.
create table if not exists public.echo_trade_callbacks (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  intent jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.echo_trade_callbacks enable row level security;
revoke all on public.echo_trade_callbacks from public, anon, authenticated;
-- SECURITY DEFINER RPC must be restricted to trusted service_role only.
create or replace function public.echo_consume_trade_callback(p_token_hash text)
returns table(intent jsonb, expires_at timestamptz)
language sql security definer set search_path = ''
as $$
  delete from public.echo_trade_callbacks c
  where c.token_hash = p_token_hash and c.expires_at > now()
  returning c.intent, c.expires_at;
$$;
revoke all on function public.echo_consume_trade_callback(text) from public, anon, authenticated;
grant execute on function public.echo_consume_trade_callback(text) to service_role;
-- Expired rows may be purged after expiry; consumed rows are deleted atomically.
