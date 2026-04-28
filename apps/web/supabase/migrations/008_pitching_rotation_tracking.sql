-- Migration 008: Pitching rotation tracking & closer support
--
-- 1. Add next_sp_slot to teams so the sim rotates starters SP1→SP2→…→SP5→SP1
-- 2. Update rotation_slot semantics:
--      1-5  = Starting Rotation (SP1-SP5)
--      6-9  = Relief Pitchers  (RP1-RP4)
--      10   = Closer           (CL)
--      0    = Reserve / unassigned
-- 3. Migrate any existing slot 6-9 data to 6-10 layout:
--    Existing RP4 (slot 9) keeps slot 9; slot 10 (CL) starts empty.

-- Add rotation tracking column to teams
alter table public.teams
  add column if not exists next_sp_slot int not null default 1;

-- Comment for clarity
comment on column public.teams.next_sp_slot is 'Next starting pitcher slot (1-5) to use in game sim; advances after each game';
comment on column public.players.rotation_slot is '1-5 SP rotation, 6-9 RP bullpen, 10 CL closer, 0 reserve';
