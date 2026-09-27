-- Festival Gallery + Jury management
-- Additive only: three new tables, their RLS policies, and a one-time copy of existing media
-- references into the new master gallery. Existing tables (gallery, testimonials, video_categories,
-- entries, payments…) are NOT altered.

-- 1. Reusable gallery categories (same pattern as video_categories) -------------------------------
create table if not exists public.media_categories (
  key            text primary key,                 -- e.g. 'award-winners' (used in ?filter=)
  label          text not null,                    -- e.g. 'Award Winners'
  sort_order     int  not null default 0,
  show_in_filter boolean not null default true,    -- appears as a filter chip on /festival-gallery
  created_at     timestamptz not null default now()
);
insert into public.media_categories (key, label, sort_order, show_in_filter) values
  ('award-winners',       'Award Winners',       1, true),
  ('festival-moments',    'Festival Moments',    2, true),
  ('jury',                'Jury',                3, true),
  ('messages-of-support', 'Messages of Support', 4, true),
  ('behind-the-scenes',   'Behind the Scenes',   5, true),
  ('festival-highlights', 'Festival Highlights', 6, false),
  ('other',               'Other',               7, false)
on conflict (key) do nothing;

-- 2. Master gallery ----------------------------------------------------------------------------------
create table if not exists public.gallery_media (
  id            bigint generated always as identity primary key,
  title         text not null default '',
  media_type    text not null check (media_type in ('photo','video')),
  category      text not null default 'other' references public.media_categories(key) on update cascade,
  image_url     text,                               -- photo (storage URL) — never file bytes
  video_url     text,                               -- YouTube URL for videos
  thumbnail_url text,                               -- optional; videos fall back to the YouTube thumbnail
  description   text not null default '',
  edition_year  int,
  display_order int  not null default 0,
  is_visible    boolean not null default true,
  is_featured   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint gallery_media_has_source check (
    (media_type = 'photo' and coalesce(image_url,'') <> '') or
    (media_type = 'video' and coalesce(video_url,'') <> '')
  )
);
create index if not exists gallery_media_order_idx on public.gallery_media (display_order, created_at);

-- 3. Jury (current + previous in one table) ---------------------------------------------------------
create table if not exists public.jury_members (
  id              bigint generated always as identity primary key,
  name            text not null,
  designation     text not null default '',
  bio             text not null default '',
  photo_url       text,                             -- same stored image is reused by the gallery
  edition_year    int,
  jury_type       text not null default 'current' check (jury_type in ('current','previous')),
  display_order   int  not null default 0,
  is_visible      boolean not null default true,
  is_active       boolean not null default true,
  show_in_gallery boolean not null default false,
  instagram_url   text,
  imdb_url        text,
  website_url     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists jury_members_order_idx on public.jury_members (jury_type, edition_year desc, display_order);

-- 4. RLS: public reads only visible rows; admins (public.is_admin()) manage everything -------------
alter table public.media_categories enable row level security;
alter table public.gallery_media    enable row level security;
alter table public.jury_members     enable row level security;

create policy media_categories_read  on public.media_categories for select using (true);
create policy media_categories_admin on public.media_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy gallery_media_read  on public.gallery_media for select using (is_visible or public.is_admin());
create policy gallery_media_admin on public.gallery_media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy jury_members_read  on public.jury_members for select
  using ((is_visible and (jury_type = 'previous' or is_active)) or public.is_admin());
create policy jury_members_admin on public.jury_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 5. One-time seed: reference (not re-upload) the existing 13 photos and 4 videos ------------------
insert into public.gallery_media (title, media_type, category, image_url, thumbnail_url, description, edition_year, display_order)
select g.title, 'photo',
       case when g.category ilike '%winner%' then 'award-winners' else 'festival-moments' end,
       g.src, nullif(g.thumb,''),
       case when coalesce(g.sub,'') ~ '^\s*\d{4}\s*$' then '' else coalesce(g.sub,'') end,   -- captions that are just a year become edition_year
       case when coalesce(g.sub,'') ~ '^\s*\d{4}\s*$' then trim(g.sub)::int end,
       coalesce(g.sort_order,0)
from public.gallery g
where not exists (select 1 from public.gallery_media m where m.image_url = g.src);

insert into public.gallery_media (title, media_type, category, video_url, thumbnail_url, description, edition_year, display_order, is_visible, is_featured)
select t.video_title, 'video',
       case when c.name ~* 'highlight|overview|presentation|aftermovie' then 'festival-highlights' else 'messages-of-support' end,
       coalesce(nullif(t.youtube_url,''), 'https://www.youtube.com/watch?v=' || t.youtube_video_id),
       nullif(t.thumbnail_url,''), coalesce(t.short_text,''), nullif(regexp_replace(coalesce(t.year::text,''),'\D','','g'),'')::int,
       100 + coalesce(t.display_order,0), coalesce(t.active,true), coalesce(t.featured,false)
from public.testimonials t
left join public.video_categories c on c.id = t.category_id
where not exists (select 1 from public.gallery_media m where m.video_url like '%' || t.youtube_video_id || '%');
