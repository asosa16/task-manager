-- Hero Web schema
-- Purpose: hosted task/link persistence with Google-authenticated users and per-user row isolation.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tone text not null default 'moss',
  created_at timestamptz not null default now(),
  constraint projects_name_per_user_unique unique (user_id, name)
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null check (type in ('task', 'link')),
  status text not null default 'upcoming' check (status in ('upcoming', 'done')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  url text,
  project_id uuid references public.projects(id) on delete set null,
  is_recurring_daily boolean not null default false,
  broken_down_from_id uuid references public.items(id) on delete set null,
  original_title text
);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_handle_updated_at
before update on public.items
for each row
execute procedure public.handle_updated_at();

alter table public.projects enable row level security;
alter table public.items enable row level security;

create policy "Users can view their own projects"
on public.projects
for select
using (auth.uid() = user_id);

create policy "Users can insert their own projects"
on public.projects
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own projects"
on public.projects
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own projects"
on public.projects
for delete
using (auth.uid() = user_id);

create policy "Users can view their own items"
on public.items
for select
using (auth.uid() = user_id);

create policy "Users can insert their own items"
on public.items
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own items"
on public.items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own items"
on public.items
for delete
using (auth.uid() = user_id);
