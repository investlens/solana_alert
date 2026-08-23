-- AlphaOS Phase 5 data-credibility provenance.
-- Additive and forward-compatible: legacy rows remain unchanged and therefore
-- explicitly unverified; new application versions write DEX_BASE_V1 only after
-- confirming the tracked mint is the priced base token.
alter table public.alpha_signals
  add column if not exists price_source_version text;

comment on column public.alpha_signals.price_source_version is
  'Versioned provenance for the market-price selection contract. NULL means legacy/unverified.';
