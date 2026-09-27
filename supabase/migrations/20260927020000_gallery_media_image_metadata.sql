-- Festival Gallery scaling: image metadata + medium size, paging index, bucket upload limits.
-- Additive only — existing rows and URLs are untouched (except linking the 5 repo thumbnails that already exist).

alter table public.gallery_media
  add column if not exists medium_url text,      -- ~1280px WebP for phones / dense screens
  add column if not exists width      int,       -- pixel size of image_url (full)
  add column if not exists height     int,
  add column if not exists file_size  int,       -- bytes of image_url
  add column if not exists mime_type  text;

-- paging: filter by category / type, ordered like the public page
create index if not exists gallery_media_page_idx on public.gallery_media (is_visible, category, is_featured desc, display_order, created_at, id);
create index if not exists gallery_media_type_idx on public.gallery_media (is_visible, media_type, is_featured desc, display_order, created_at, id);

-- the five repo-hosted photos already have 480px thumbnails in /Gallery/thumbs — link them
update public.gallery_media
   set thumbnail_url = replace(image_url, 'Gallery/display/', 'Gallery/thumbs/')
 where media_type = 'photo' and thumbnail_url is null and image_url like 'Gallery/display/%.webp';

-- Server-side upload guard for the public "gallery" bucket: images only, 10 MB max per file.
-- (The admin always uploads browser-optimised WebP, typically 50–500 KB.)
update storage.buckets
   set allowed_mime_types = array['image/webp','image/jpeg','image/png'],
       file_size_limit    = 10485760
 where id = 'gallery';
