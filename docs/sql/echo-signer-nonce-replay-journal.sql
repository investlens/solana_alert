-- REVIEW ONLY. Dedicated signer replay-protection nonce journal.
-- DO NOT APPLY until the correct dedicated signer database and privileges are audited.
-- The nonce is persisted BEFORE authorizing preview and MUST never be reused.
begin;
create table if not exists public.echo_signer_used_nonces (
  nonce_hex text primary key check (nonce_hex ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz not null default now()
);
create or replace function public.echo_signer_consume_nonce(
  p_nonce_hex text, p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
 if p_nonce_hex is null or p_nonce_hex !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= pg_catalog.now()
    or p_expires_at > pg_catalog.now() + interval '30 seconds'
 then return false; end if;
 insert into public.echo_signer_used_nonces(nonce_hex,expires_at)
 values(p_nonce_hex,p_expires_at)
 on conflict (nonce_hex) do nothing;
 return found;
end;
$$;
revoke all on table public.echo_signer_used_nonces from public,anon,authenticated;
revoke all on function public.echo_signer_consume_nonce(text,timestamptz)
 from public,anon,authenticated;
grant select,insert on table public.echo_signer_used_nonces to service_role;
grant execute on function public.echo_signer_consume_nonce(text,timestamptz)
 to service_role;
commit;
-- Important: NO automatic cleanup in this migration; same nonce must not
-- become reusable merely because it expired.
