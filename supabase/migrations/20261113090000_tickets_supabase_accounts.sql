-- Tickets belong to supabase.com accounts, not to this project's own users.
-- Every write goes through /api/ticket, which checks the caller's supabase.com
-- session and writes with the secret key. Browsers only read.

-- the supabase.com account that made it; none for tickets seeded for the stack
alter table public.tickets drop constraint tickets_user_id_fkey;
alter table public.tickets alter column user_id drop default;
comment on column public.tickets.user_id is 'the supabase.com account id (checked by /api/ticket); null for seeded tickets';

-- no writes from browsers: the secret key bypasses RLS, the publishable key can't
drop policy "tickets: make your own" on public.tickets;
drop policy "tickets: remix your own" on public.tickets;
drop policy "tickets bucket: upload your own" on storage.objects;
