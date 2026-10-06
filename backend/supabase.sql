-- Run this in the Supabase SQL Editor for the project Chatshit will use.
-- It adds Chatshit-specific tables and a private media bucket without backfilling
-- Auth users from other apps that may share this Supabase project.
-- Enable Anonymous Sign-Ins in Authentication > Providers for Chatshit visitors.

create table if not exists public.global_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.global_messages add column if not exists image_path text;

create index if not exists global_messages_created_at_idx on public.global_messages (created_at desc);
create index if not exists global_messages_user_created_idx on public.global_messages (user_id, created_at desc);

create or replace function public.chatshit_limit_message_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.global_messages
  where user_id = new.user_id
    and created_at > now() - interval '1 minute';
  if recent_count >= 20 then
    raise exception 'Message rate limit reached. Please wait a minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists global_messages_rate_limit on public.global_messages;
create trigger global_messages_rate_limit
  before insert on public.global_messages
  for each row execute function public.chatshit_limit_message_rate();

create table if not exists public.global_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  body text not null check (char_length(body) between 1 and 60),
  music_url text check (music_url is null or char_length(music_url) <= 500),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  updated_at timestamptz not null default now()
);

create table if not exists public.chatshit_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.global_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  caption text check (caption is null or char_length(caption) <= 120),
  image_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint global_stories_need_content check (caption is not null or image_path is not null),
  constraint global_stories_expire_within_24h check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);

create index if not exists global_stories_active_idx on public.global_stories (expires_at, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chatshit-media', 'chatshit-media', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Do not backfill auth.users here: this schema can share a Supabase project with other apps.
-- Chatshit profiles are created when each visitor opens Chatshit.

alter table public.global_messages enable row level security;
alter table public.global_notes enable row level security;
alter table public.chatshit_profiles enable row level security;
alter table public.global_stories enable row level security;

grant select, insert on public.global_messages to authenticated;
grant select, insert, update, delete on public.global_notes to authenticated;
grant select, insert, update on public.chatshit_profiles to authenticated;
grant select, insert, delete on public.global_stories to authenticated;

drop policy if exists "Signed-in users can read global messages" on public.global_messages;
create policy "Signed-in users can read global messages" on public.global_messages
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "Users can post as themselves" on public.global_messages;
create policy "Users can post as themselves" on public.global_messages
  for insert to authenticated with check (
    auth.uid() = user_id
    and (image_path is null or split_part(image_path, '/', 1) = auth.uid()::text)
  );

drop policy if exists "Signed-in users can read active stories" on public.global_stories;
create policy "Signed-in users can read active stories" on public.global_stories
  for select to authenticated using (auth.uid() is not null and expires_at > now());

drop policy if exists "Users can post their own stories" on public.global_stories;
create policy "Users can post their own stories" on public.global_stories
  for insert to authenticated with check (
    auth.uid() = user_id
    and expires_at > now()
    and (image_path is null or split_part(image_path, '/', 1) = auth.uid()::text)
  );

drop policy if exists "Users can delete their own stories" on public.global_stories;
create policy "Users can delete their own stories" on public.global_stories
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Authenticated users can upload their own Chatshit media" on storage.objects;
create policy "Authenticated users can upload their own Chatshit media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chatshit-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Signed-in members can read Chatshit media" on storage.objects;
create policy "Signed-in members can read Chatshit media" on storage.objects
  for select to authenticated using (bucket_id = 'chatshit-media');

drop policy if exists "Authenticated users can delete their own Chatshit media" on storage.objects;
create policy "Authenticated users can delete their own Chatshit media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'chatshit-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.cleanup_expired_chatshit_stories()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from storage.objects as objects
  using public.global_stories as stories
  where objects.bucket_id = 'chatshit-media'
    and objects.name = stories.image_path
    and stories.image_path is not null
    and stories.expires_at <= now();

  delete from public.global_stories where expires_at <= now();
end;
$$;

revoke all on function public.cleanup_expired_chatshit_stories() from public;
grant execute on function public.cleanup_expired_chatshit_stories() to authenticated;

drop policy if exists "Signed-in users can read active notes" on public.global_notes;
create policy "Signed-in users can read active notes" on public.global_notes
  for select to authenticated using (auth.uid() is not null and expires_at > now());

drop policy if exists "Users can create their own note" on public.global_notes;
create policy "Users can create their own note" on public.global_notes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own note" on public.global_notes;
create policy "Users can update their own note" on public.global_notes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can clear their own note" on public.global_notes;
create policy "Users can clear their own note" on public.global_notes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Signed-in users can read community profiles" on public.chatshit_profiles;
create policy "Signed-in users can read community profiles" on public.chatshit_profiles
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "Users can create their own profile" on public.chatshit_profiles;
create policy "Users can create their own profile" on public.chatshit_profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own profile" on public.chatshit_profiles;
create policy "Users can update their own profile" on public.chatshit_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.global_messages;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.global_notes;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.chatshit_profiles;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.global_stories;
exception when duplicate_object then null;
end $$;
