-- Persist PONS sustained intelligence across restarts.
-- Additive only; no historical state is fabricated.
alter table public.pons_shadow_trades
  add column if not exists intelligence_state text;

alter table public.pons_shadow_trades
  add column if not exists intelligence_state_observed_at timestamptz;

comment on column public.pons_shadow_trades.intelligence_state is
  'Latest persisted sustained intelligence state; separate from commercial PONS alpha thresholds.';

comment on column public.pons_shadow_trades.intelligence_state_observed_at is
  'Observation boundary used to ensure RUNNER requires an observation later than CONFIRMED.';
