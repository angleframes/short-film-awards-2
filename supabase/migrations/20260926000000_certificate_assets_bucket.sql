-- Certificate template assets (backgrounds with logos + signatures, config.json).
-- Additive only: creates one PRIVATE bucket and admin-only policies. No tables or existing policies change.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-assets', 'certificate-assets', false, 15728640,
        array['image/jpeg', 'image/png', 'application/json'])
on conflict (id) do nothing;

create policy certificate_assets_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'certificate-assets' and public.is_admin());

create policy certificate_assets_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'certificate-assets' and public.is_admin());

create policy certificate_assets_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'certificate-assets' and public.is_admin())
  with check (bucket_id = 'certificate-assets' and public.is_admin());

create policy certificate_assets_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'certificate-assets' and public.is_admin());
