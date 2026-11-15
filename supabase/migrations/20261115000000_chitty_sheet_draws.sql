-- ANGLE FRAMES CHITTY — Google Sheet live draw: winner history, audit log and draw locks.
--
-- The Google Sheet stays the source of truth for participants and existing winners.
-- These tables only record draws made through the chitty-draw edge function, so a winner can
-- never be drawn twice even if the sheet write-back fails or is edited later.
-- All writes happen in the edge function with the service role; admins can read.

create table if not exists public.chitty_draws (
  id               bigint generated always as identity primary key,
  draw_id          uuid        not null unique default gen_random_uuid(),
  request_id       text        not null unique,             -- idempotency key from the client
  category         text        not null check (category in ('1000', '3000')),
  sheet_id         text        not null,
  sheet_tab        text        not null,
  sheet_row        integer     not null check (sheet_row > 0),
  name_cell        text        not null,                     -- e.g. A9  (source record reference)
  status_cell      text        not null,                     -- e.g. B9  (where WINNER is written)
  participant_name text        not null,
  eligible_count   integer     not null check (eligible_count > 0),
  pool_sha256      text        not null,                     -- fingerprint of the eligible pool used
  admin_user_id    uuid        not null references auth.users (id),
  admin_email      text,
  drawn_at         timestamptz not null default now(),
  sheet_status     text        not null default 'pending'
                   check (sheet_status in ('pending', 'written', 'failed')),
  sheet_written_at timestamptz,
  sheet_error      text
);

-- One win per sheet slot: the same row/name can never be recorded as a winner twice.
create unique index if not exists chitty_draws_one_win_per_slot
  on public.chitty_draws (sheet_id, category, name_cell, lower(participant_name));
create index if not exists chitty_draws_drawn_at on public.chitty_draws (drawn_at desc);

comment on table public.chitty_draws is
  'Winners drawn by the chitty-draw edge function from the Google Sheet. Never deleted. Written only with the service role.';

create table if not exists public.chitty_draw_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  admin_user_id uuid,
  admin_email   text,
  action        text not null,
  category      text,
  outcome       text not null,
  detail        jsonb
);
create index if not exists chitty_draw_events_admin_at on public.chitty_draw_events (admin_user_id, at desc);

comment on table public.chitty_draw_events is
  'Audit log of every chitty draw operation (pool loads, draws, refusals, sheet errors).';

-- Short-lived per-category lock so two admins/tabs cannot draw the same category at once.
create table if not exists public.chitty_draw_locks (
  category     text primary key check (category in ('1000', '3000')),
  holder       uuid,
  locked_until timestamptz not null default 'epoch'
);
insert into public.chitty_draw_locks (category) values ('1000'), ('3000') on conflict do nothing;

create or replace function public.chitty_acquire_lock(p_category text, p_holder uuid, p_seconds integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  with got as (
    update public.chitty_draw_locks
       set holder = p_holder,
           locked_until = now() + make_interval(secs => least(greatest(p_seconds, 5), 120))
     where category = p_category and locked_until < now()
     returning 1
  )
  select exists (select 1 from got);
$$;

create or replace function public.chitty_release_lock(p_category text, p_holder uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chitty_draw_locks
     set holder = null, locked_until = 'epoch'
   where category = p_category and holder = p_holder;
$$;

revoke all on function public.chitty_acquire_lock(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.chitty_release_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.chitty_acquire_lock(text, uuid, integer) to service_role;
grant execute on function public.chitty_release_lock(text, uuid) to service_role;

alter table public.chitty_draws       enable row level security;
alter table public.chitty_draw_events enable row level security;
alter table public.chitty_draw_locks  enable row level security;

-- Admins may read history and audit logs; nobody but the service role may write.
drop policy if exists chitty_draws_admin_read on public.chitty_draws;
create policy chitty_draws_admin_read on public.chitty_draws
  for select to authenticated using (public.is_admin());

drop policy if exists chitty_draw_events_admin_read on public.chitty_draw_events;
create policy chitty_draw_events_admin_read on public.chitty_draw_events
  for select to authenticated using (public.is_admin());
