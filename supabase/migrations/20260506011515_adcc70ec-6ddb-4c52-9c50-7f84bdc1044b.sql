insert into storage.buckets (id, name, public) values ('scene-backgrounds', 'scene-backgrounds', true) on conflict (id) do nothing;

create policy "scene-backgrounds public read"
on storage.objects for select
using (bucket_id = 'scene-backgrounds');

create policy "scene-backgrounds public write"
on storage.objects for insert
with check (bucket_id = 'scene-backgrounds');

create policy "scene-backgrounds public update"
on storage.objects for update
using (bucket_id = 'scene-backgrounds');

create policy "scene-backgrounds public delete"
on storage.objects for delete
using (bucket_id = 'scene-backgrounds');