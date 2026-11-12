-- Bandy Song browser – Supabase schema.
-- Run this whole file once in your Supabase project: Dashboard -> SQL Editor -> New query -> Run.
-- It is safe to re-run. See docs/SONG_BROWSER.md for the full setup.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- songs
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  artist text not null check (char_length(artist) between 1 and 60),
  genre text not null default 'Other' check (char_length(genre) <= 30),
  description text check (char_length(description) <= 500),
  file_path text not null unique,
  file_size integer not null check (file_size between 1024 and 20971520),
  mime text not null check (mime in ('audio/mpeg','audio/wav','audio/ogg','audio/mp4','audio/aac','audio/flac')),
  duration real check (duration is null or duration between 0 and 86400),
  rights_confirmed boolean not null check (rights_confirmed),
  plays integer not null default 0,
  likes integer not null default 0,
  reports integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists songs_created_idx on public.songs (created_at desc);
create index if not exists songs_likes_idx on public.songs (likes desc);
create index if not exists songs_user_idx on public.songs (user_id);

-- ---------------------------------------------------------------- likes & reports
create table if not exists public.likes (
  song_id uuid not null references public.songs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
);
create table if not exists public.reports (
  song_id uuid not null references public.songs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
);

-- ---------------------------------------------------------------- row level security
alter table public.songs enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;

drop policy if exists "songs are public unless hidden" on public.songs;
create policy "songs are public unless hidden" on public.songs for select using (not hidden or user_id = auth.uid());
drop policy if exists "users insert their own songs" on public.songs;
create policy "users insert their own songs" on public.songs for insert to authenticated
  with check (user_id = auth.uid() and file_path like auth.uid()::text || '/%');
drop policy if exists "users edit their own songs" on public.songs;
create policy "users edit their own songs" on public.songs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users delete their own songs" on public.songs;
create policy "users delete their own songs" on public.songs for delete to authenticated using (user_id = auth.uid());

drop policy if exists "users see their own likes" on public.likes;
create policy "users see their own likes" on public.likes for select to authenticated using (user_id = auth.uid());
drop policy if exists "users like as themselves" on public.likes;
create policy "users like as themselves" on public.likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users unlike their own likes" on public.likes;
create policy "users unlike their own likes" on public.likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "users report as themselves" on public.reports;
create policy "users report as themselves" on public.reports for insert to authenticated with check (user_id = auth.uid());

-- Column-level privileges: clients may never write counters or the hidden flag.
revoke all on public.songs, public.likes, public.reports from anon, authenticated;
grant select on public.songs to anon, authenticated;
grant insert (title, artist, genre, description, file_path, file_size, mime, duration, rights_confirmed) on public.songs to authenticated;
grant update (title, artist, genre, description) on public.songs to authenticated;
grant delete on public.songs to authenticated;
grant select, insert, delete on public.likes to authenticated;
grant insert on public.reports to authenticated;

-- ---------------------------------------------------------------- triggers & functions
-- keep songs.likes in sync
create or replace function public.sync_likes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.songs set likes = likes + 1 where id = new.song_id;
  else update public.songs set likes = greatest(0, likes - 1) where id = old.song_id; end if;
  return null;
end $$;
drop trigger if exists likes_sync on public.likes;
create trigger likes_sync after insert or delete on public.likes for each row execute function public.sync_likes();

-- hide a song once it has 3 reports (change the threshold here)
create or replace function public.count_report() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.songs set reports = reports + 1, hidden = hidden or (reports + 1 >= 3) where id = new.song_id;
  return null;
end $$;
drop trigger if exists reports_count on public.reports;
create trigger reports_count after insert on public.reports for each row execute function public.count_report();

-- at most 5 uploads per user per day (change the number here and in js/site/config.js)
create or replace function public.limit_uploads() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.songs where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Daily upload limit reached';
  end if;
  return new;
end $$;
drop trigger if exists songs_limit_uploads on public.songs;
create trigger songs_limit_uploads before insert on public.songs for each row execute function public.limit_uploads();

-- trigger functions must not be callable through the REST API
revoke execute on function public.sync_likes() from public, anon, authenticated;
revoke execute on function public.count_report() from public, anon, authenticated;
revoke execute on function public.limit_uploads() from public, anon, authenticated;

-- play counter (approximate by design; the site only calls it once per song per page view)
create or replace function public.record_play(song_id uuid) returns void language sql security definer set search_path = public as $$
  update public.songs set plays = plays + 1 where id = song_id and not hidden;
$$;
revoke all on function public.record_play(uuid) from public;
grant execute on function public.record_play(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('songs', 'songs', true, 20971520, array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/flac'])
on conflict (id) do update set public = true, file_size_limit = 20971520,
  allowed_mime_types = array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/flac'];

drop policy if exists "songs upload into own folder" on storage.objects;
create policy "songs upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "songs delete own files" on storage.objects;
create policy "songs delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = auth.uid()::text);
-- Files are served from the public bucket URL, so no select policy is needed.

-- ---------------------------------------------------------------- moderation helpers (run manually as the project owner)
--   Hidden songs awaiting review:   select id, title, artist, reports from public.songs where hidden order by reports desc;
--   Restore a song after review:    update public.songs set hidden = false, reports = 0 where id = '<song id>';
--   Remove a song for good:         delete from public.songs where id = '<song id>';   (then delete its file in Storage)
