-- Last touched by agent: 2026-05-06T15:02:00Z
-- Purpose: Adds persisted game-level error totals for replay R/H/E linescore.

alter table public.games
  add column if not exists home_errors int not null default 0,
  add column if not exists visitor_errors int not null default 0;
