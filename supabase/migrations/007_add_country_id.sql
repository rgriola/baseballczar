-- Add country_id column to players (matches original Java schema)
-- Default 1 = USA
alter table public.players
  add column country_id int not null default 1;
