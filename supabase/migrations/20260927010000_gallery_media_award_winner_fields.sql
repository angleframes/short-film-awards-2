-- Structured Award Winner data on the Festival Gallery (additive; existing rows untouched except the backfill below)
alter table public.gallery_media
  add column if not exists award_id          bigint references public.award_categories(id) on delete set null,
  add column if not exists award_name        text,   -- snapshot of the award name, used if the award is later deleted
  add column if not exists competition_track text check (competition_track in ('general','campus')),
  add column if not exists winner_name       text,   -- person (director, actor, …) — optional for film awards
  add column if not exists film_name         text,
  add column if not exists recipient_type    text check (recipient_type in ('film','person'));

create index if not exists gallery_media_award_idx on public.gallery_media (award_id) where award_id is not null;

-- Backfill the three existing winner photos from their current titles (titles themselves are kept)
update public.gallery_media m set award_id = a.id, award_name = a.name, competition_track = 'general', film_name = 'Bug', recipient_type = 'film'
  from public.award_categories a where a.key = 'best_short_film' and m.id = 6 and m.award_id is null;
update public.gallery_media m set award_id = a.id, award_name = a.name, competition_track = 'campus', film_name = 'Timeless', recipient_type = 'film'
  from public.award_categories a where a.key = 'best_campus_film' and m.id = 7 and m.award_id is null;
update public.gallery_media m set award_id = a.id, award_name = a.name, competition_track = 'general', film_name = 'Treesa', recipient_type = 'film'
  from public.award_categories a where a.key = 'special_jury' and m.id = 18 and m.award_id is null;
