-- 汉字 Flashcards: cloud profiles.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- One row per child profile. A signed-in account (the parent) can only see and
-- change its own profiles (row-level security below).

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  avatar      text not null default '🐼',
  -- {"progress": {字: {...}}, "activity": {"2026-11-15": {...}}, "voice": "xiaoxiao"}
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);

alter table public.profiles enable row level security;

drop policy if exists "profiles: owner only" on public.profiles;
create policy "profiles: owner only" on public.profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- keep updated_at current on every change
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
