-- Immutable scheduled measurements belonging to alpha_alert_events.
create table if not exists public.alpha_alert_outcomes (
  id bigserial primary key,
  alert_event_id bigint not null references public.alpha_alert_events(id) on delete restrict,
  checkpoint_seconds integer not null,
  current_roi numeric,
  peak_roi numeric,
  time_to_peak_seconds integer,
  max_drawdown numeric,
  current_price numeric,
  peak_price numeric,
  measurement_source text,
  price_provenance text,
  measured_at timestamptz not null,
  status text not null,
  completeness jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint alpha_alert_outcomes_checkpoint_check check
    (checkpoint_seconds in (30, 60, 180, 300, 900, 1800, 3600)),
  constraint alpha_alert_outcomes_status_check check
    (status in ('MEASURED', 'UNAVAILABLE', 'PARTIAL')),
  constraint alpha_alert_outcomes_unique_checkpoint unique
    (alert_event_id, checkpoint_seconds)
);

create index if not exists alpha_alert_outcomes_event_idx
  on public.alpha_alert_outcomes(alert_event_id, checkpoint_seconds);
create index if not exists alpha_alert_outcomes_measured_at_idx
  on public.alpha_alert_outcomes(measured_at desc);

drop trigger if exists alpha_alert_outcomes_no_update on public.alpha_alert_outcomes;
create trigger alpha_alert_outcomes_no_update before update on public.alpha_alert_outcomes
for each row execute function public.reject_alpha_alert_event_mutation();
drop trigger if exists alpha_alert_outcomes_no_delete on public.alpha_alert_outcomes;
create trigger alpha_alert_outcomes_no_delete before delete on public.alpha_alert_outcomes
for each row execute function public.reject_alpha_alert_event_mutation();

comment on table public.alpha_alert_outcomes is
  'Append-only, retry-idempotent post-alert measurements. Unavailable measurements are recorded explicitly, never fabricated.';
