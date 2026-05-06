-- Last touched by agent: 2026-05-06T03:12:05Z
-- Purpose: Adds per-play telemetry columns to game_events for persisted replay fidelity.

alter table public.game_events
  add column if not exists spray_angle_deg real,
  add column if not exists launch_angle_deg real,
  add column if not exists exit_velo_mph real,
  add column if not exists ball_path_waypoints jsonb,
  add column if not exists base_occupancy_before jsonb,
  add column if not exists base_occupancy_after jsonb;
