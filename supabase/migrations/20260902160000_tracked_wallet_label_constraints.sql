alter table public.user_tracked_wallets
  drop constraint if exists user_tracked_wallets_label_valid;

alter table public.user_tracked_wallets
  add constraint user_tracked_wallets_label_valid
  check (
    label is null
    or (
      char_length(label) between 1 and 64
      and label = btrim(label)
      and label !~ '[[:cntrl:]]'
    )
  );

comment on column public.user_tracked_wallets.label is
  'Optional per-user presentation label. Never used as wallet identity or intelligence evidence.';
