-- Run this in the Supabase SQL Editor after creating a project.
-- Then enable Anonymous Sign-Ins in Authentication > Providers.

create table if not exists public.global_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

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

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill existing anonymous and registered Auth users so the directory is complete.
insert into public.profiles (user_id, display_name, created_at)
select u.id,
  left(coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'), ''), 'Chatshit user'), 28),
  u.created_at
from auth.users as u
on conflict (user_id) do nothing;

alter table public.global_messages enable row level security;
alter table public.global_notes enable row level security;
alter table public.profiles enable row level security;

grant select, insert on public.global_messages to authenticated;
grant select, insert, update, delete on public.global_notes to authenticated;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "Signed-in users can read global messages" on public.global_messages;
create policy "Signed-in users can read global messages" on public.global_messages
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "Users can post as themselves" on public.global_messages;
create policy "Users can post as themselves" on public.global_messages
  for insert to authenticated with check (auth.uid() = user_id);

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

drop policy if exists "Signed-in users can read community profiles" on public.profiles;
create policy "Signed-in users can read community profiles" on public.profiles
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
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
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;
