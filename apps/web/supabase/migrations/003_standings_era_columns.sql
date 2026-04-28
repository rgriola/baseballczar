-- Add ERA tracking columns to standings
alter table public.standings add column if not exists era_runs int not null default 0;
alter table public.standings add column if not exists era_outs int not null default 0;
