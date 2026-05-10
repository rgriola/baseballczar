# May 10 Walkthrough: Client-Side Tick Engine Replay + Physics Fixes

## Session Summary

This session accomplished two major milestones:
1. **Client-side tick engine for dashboard replays** — games now re-simulate using the stored seed and frozen roster snapshots, producing identical 30fps physics as Sim Lab 2.
2. **Grounder physics fixes** — fixed balls "exploding off screen" for negative launch angle contact.

---

## 1. Client-Side Tick Engine Replay Pipeline

### Architecture

```
Sim Worker → games.home_roster_snapshot (JSONB)
           → games.visitor_roster_snapshot (JSONB)
           → games.sim_seed (int)

User opens replay → GET /api/games/:id → { seed, rosters }
                  → Client: createRng(seed) → simulateGame() → simulateFullGame()
                  → 30fps WorldSnapshots → TickFieldCanvas renderer
```

### Changes Made

#### Database (Migrations 013 + 014)
- `013_game_roster_snapshots.sql` — Added `home_roster_snapshot` and `visitor_roster_snapshot` JSONB columns to `games` table
- `014_update_rpc_roster_snapshots.sql` — Updated `persist_sim_game_transaction` RPC to include the new columns in its INSERT statement (this was a critical miss — the RPC had a hardcoded column list)

#### Sim Persistence Chain
- [simulate-scheduled-game.ts](file:///Users/rodczaro/Desktop/00-Vibecode/baseballczar-v2/apps/web/src/lib/sim/simulate-scheduled-game.ts) — Added `buildRosterSnapshot()`, `snapshotPlayer()`, exported `RosterSnapshot`/`PlayerSnapshot` types. Captures game-day player skills at simulation time.
- [persist-game.ts](file:///Users/rodczaro/Desktop/00-Vibecode/baseballczar-v2/apps/web/src/lib/sim/persist-game.ts) — Threads `homeRosterSnapshot`/`visitorRosterSnapshot` through `PersistOptions`
- [persist-game-record.ts](file:///Users/rodczaro/Desktop/00-Vibecode/baseballczar-v2/apps/web/src/lib/sim/persist-game-record.ts) — Added snapshot fields to `GameRecordOpts` and `buildGameInsertRow()`

#### Client Re-Simulation
- [persisted-replay-resim.ts](file:///Users/rodczaro/Desktop/00-Vibecode/baseballczar-v2/apps/web/src/app/dashboard/games/%5Bid%5D/persisted-replay-resim.ts) — **NEW** module: `canResimulate()` + `resimulateForReplay()` + `snapshotToTeam()`. Runs `createRng(seed)` → `simulateGame()` → `simulateFullGame()` entirely client-side.
- [persisted-replay.tsx](file:///Users/rodczaro/Desktop/00-Vibecode/baseballczar-v2/apps/web/src/app/dashboard/games/%5Bid%5D/persisted-replay.tsx) — Uses resim when snapshots available, falls back to legacy reconstruction for old games. Added "Generating replay physics..." spinner.

### Storage Cost
~4-8 KB per game. 162 games × 15 teams per season = ~1.2 MB total. Negligible.

### Legacy Fallback
Games without `home_roster_snapshot` (pre-migration) use the old `buildPersistedSnapshots()` reconstruction pipeline automatically.

---

## 2. Grounder Physics Fixes

### Bug: 280 ft grounders
**Root cause (sim-engine)**: `ballFlight.ts` grounder distance formula had unclamped `evNorm`. EV 118 mph produced `evNorm = 1.13` instead of max 1.0, yielding `20 + 1.13 × 230 = 280 ft`.

**Fix**: Clamped `evNorm` to [0,1] and reduced max grounder distance from 250→150 ft.

### Bug: Grounders exploding off screen in tick engine
**Root cause (tick-engine)**: `ballPhysics.ts` `calibrateLaunch()` was multiplying negative `vVert` by hang-time scaling factors. For LA -11°, `vVert = -24 fps`, calibrator tried `hangScale = 3.2`, producing `vVert = -77 fps` — ball rocketed into the ground.

**Fix**: Grounders (negative `baseVert`) bypass vertical calibration entirely. They get a gentle `-G × 0.15` downward velocity and horizontal-only distance calibration. The bounce/roll physics handles the rest.

### Enhancement: Impact-velocity-dependent ground absorption
The ground now absorbs energy proportional to impact velocity:

| Impact | Vert Retention | Horiz Retention |
|--------|---------------|-----------------|
| Soft landing | 35% | 75% |
| Medium (liner) | 27% | 55% |
| Hard (chopper) | 20% | 35% |
| **Dirt surface** | ×0.85 | ×0.85 |

---

## 3. Earlier Session Fixes (from truncated context)

- **Budget self-healing**: `ensureBudgetRows()` auto-creates missing `team_budgets` rows for teams created before the budget system
- **PBP text visibility**: Added `text-white` to dashboard layout wrapper — fixed black-on-black text on dark background
- **Season reset stability**: Fixed `ECONNRESET` errors during season reset

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/supabase/migrations/013_game_roster_snapshots.sql` | NEW — DB columns |
| `apps/web/supabase/migrations/014_update_rpc_roster_snapshots.sql` | NEW — RPC update |
| `apps/web/src/lib/sim/simulate-scheduled-game.ts` | Roster snapshot capture |
| `apps/web/src/lib/sim/persist-game.ts` | Thread snapshots through |
| `apps/web/src/lib/sim/persist-game-record.ts` | Insert row fields |
| `apps/web/src/app/dashboard/games/[id]/persisted-replay-resim.ts` | NEW — client resim |
| `apps/web/src/app/dashboard/games/[id]/persisted-replay.tsx` | Resim integration + loading |
| `packages/sim-engine/src/physics/ballFlight.ts` | Grounder distance fix |
| `packages/tick-engine/src/ballPhysics.ts` | Grounder calibration + ground absorption |
| `README.md` | Migration docs updated |

## Verification

- **Production build**: `npm run build` ✅ passes
- **Sim-engine**: `npm run build -w @baseballczar/sim-engine` ✅
- **Tick-engine**: `npm run build -w @baseballczar/tick-engine` ✅
- **Console diagnostic**: `[Replay] ✅ Using TICK ENGINE re-simulation (30fps physics)` confirmed
- **Replay quality**: User confirmed "sim is looking a lot better" — 15,709 snapshots generated client-side

## Next Up

- General Defensive strategy for players
- General Runner Requirements
