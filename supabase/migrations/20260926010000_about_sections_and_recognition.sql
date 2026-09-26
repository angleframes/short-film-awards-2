-- About section content (homepage chapters + "Know More" stories). Additive only.
create table if not exists public.about_sections (
  key         text primary key check (key ~ '^[a-z0-9_-]{1,40}$'),
  sort_order  integer not null default 0,
  visible     boolean not null default true,
  kicker      text,
  title       text not null,
  subtitle    text,
  intro       text,
  image_url   text,
  image_alt   text,
  image_fit   text not null default 'cover' check (image_fit in ('cover','contain')),
  cta_label   text,
  body        text,
  link_label  text,
  link_url    text check (link_url is null or link_url = '' or link_url ~* '^(https?://|#|mailto:|tel:)'),
  updated_at  timestamptz not null default now()
);
alter table public.about_sections enable row level security;
create policy about_sections_read  on public.about_sections for select using (true);
create policy about_sections_admin on public.about_sections for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Prizes & Recognition settings (pending from the previous change)
alter table public.site_config add column if not exists recognition jsonb;
