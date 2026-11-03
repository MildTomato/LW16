-- Every visitor makes one ticket: their own Visual Engine artwork with their
-- username etched in the corner. The stack on the site is made of the latest.
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- the visitor who made it (signed in anonymously); none for tickets seeded for the stack
  user_id uuid unique default auth.uid() references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{2,24}$'),
  engine text not null check (char_length(engine) <= 40),
  seed integer not null check (seed between 1 and 999999),
  layers integer not null check (layers between 1 and 6),
  engine_rev text not null check (char_length(engine_rev) <= 40),
  -- the artwork as the engine's layers (generator, settings, seed, placement,
  -- clip, opacity): it can be redrawn, and recut layer by layer, whatever the engine becomes
  composition jsonb not null check (
    jsonb_typeof(composition) = 'array'
    and jsonb_array_length(composition) between 1 and 6
    and octet_length(composition::text) < 65536
  ),
  -- the rendered ticket in the tickets bucket: <user id or seed>/<version>.webp
  image_path text not null check (char_length(image_path) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_image_in_own_folder check (user_id is null or image_path like (user_id::text || '/%'))
);
create index tickets_updated_at on public.tickets (updated_at desc);

alter table public.tickets enable row level security;
create policy "tickets: anyone can read"
  on public.tickets for select to anon, authenticated using (true);
create policy "tickets: make your own"
  on public.tickets for insert to authenticated with check (user_id = (select auth.uid()));
create policy "tickets: remix your own"
  on public.tickets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.tickets_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end $$;
create trigger tickets_touch before update on public.tickets
  for each row execute function public.tickets_touch();

-- new and remixed tickets reach every open stack
alter publication supabase_realtime add table public.tickets;

-- the rendered tickets: public to look at, each person writes only their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tickets', 'tickets', true, 2097152, array['image/webp']);
create policy "tickets bucket: upload your own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- every ticket is numbered, in the order it was made (seeds first)
alter table public.tickets add column number integer generated always as identity;
alter table public.tickets add constraint tickets_number_key unique (number);
