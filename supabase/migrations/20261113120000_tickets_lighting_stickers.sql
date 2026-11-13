-- A ticket's light and its stickers, made in the ticket maker.

-- the light it's shown in: one of the scene's lightings, by name; none is the site's own
alter table public.tickets add column lighting text check (char_length(lighting) <= 40);

-- the stickers on it: which one, where on the card (0..1), how big and turned how far
alter table public.tickets add column stickers jsonb not null default '[]'::jsonb check (
  jsonb_typeof(stickers) = 'array'
  and jsonb_array_length(stickers) <= 12
  and octet_length(stickers::text) < 4096
);
