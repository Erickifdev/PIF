-- Run this once in the Supabase SQL Editor for the PIF project.
-- Each signed-in user gets one private row containing their study data.

create table if not exists public.PIF_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{"subjects": [], "practicedSessions": 0}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.PIF_data enable row level security;

grant select, insert, update, delete
  on table public.PIF_data
  to authenticated;

drop policy if exists "Users manage their own PIF data"
  on public.PIF_data;

create policy "Users manage their own Estudaí data"
  on public.PIF_data
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
