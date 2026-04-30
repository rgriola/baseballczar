# Baseball Czar v2

A baseball management simulation game — draft players, set lineups, manage finances, and compete across a full season. Originally a Java desktop app with a separate simulation daemon, now rebuilt as a TypeScript monorepo targeting web and iOS.

## Monorepo Structure

```
baseballczar-v2/
├── apps/
│   ├── web/              # Next.js web app (@baseballczar/web)
│   └── ios/              # Expo React Native app (@baseballczar/ios)
├── packages/
│   └── sim-engine/       # Shared physics sim engine (@baseballczar/sim-engine)
├── package.json          # Workspace root (npm workspaces)
├── review/               # Code review documents
└── IOS_STRATEGY.md       # iOS product strategy and 5-phase build plan
```

## Tech Stack

### Web (`apps/web`)

- **Framework:** Next.js 16 (App Router, Server Components)
- **Database:** Supabase (PostgreSQL + Auth + Row Level Security)
- **Styling:** Tailwind CSS
- **Validation:** Zod v4
- **Monitoring:** Sentry
- **Rate Limiting:** Upstash Redis
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Queue:** BullMQ + ioredis

### iOS (`apps/ios`)

- **Framework:** Expo + React Native
- **Renderer:** React Native Skia (2D field visualization)
- **Router:** Expo Router (file-based)

### Sim Engine (`packages/sim-engine`)

- **Language:** TypeScript (strict, no DOM deps)
- **RNG:** Seedable mulberry32 — fully reproducible
- **Physics:** Ball flight, park geometry, throw velocity (~85 mph), runner times (22–28 ft/sec)
- **Skill scale:** 1–10 across 9 attributes (avg, power, eye, speed, defense, stamina, pitchIntel, dhr, ag)
- **CONFIG_V1 baseline** (162 games, seed 1): BB% .085 | K% .251 | BABIP .322 | HR/FB .148 | R/G 4.08

## Prerequisites

- Node.js 20+
- npm 8+ (workspaces support)
- A [Supabase](https://supabase.com) project (free tier works)
- Supabase CLI for local development

## Getting Started

```bash
git clone https://github.com/rgriola/baseballczar.git
cd baseballczar-v2
npm install          # installs all workspaces
```

### Web app

```bash
# Create apps/web/.env.local with:
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SENTRY_DSN=your-sentry-dsn          # optional
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

npx supabase db push   # apply migrations
npm run dev            # → http://localhost:3000
```

### Sim engine (standalone)

```bash
npm run sim                              # 162-game season, random seed
npm run sim -- --games 10 --seed 42     # reproducible 10-game run
npm run sim -- --events out.json        # write game 1 event log
npm run skill-test                       # skill sensitivity harness
```

## Project Structure

### `packages/sim-engine/src/`

```
config.ts         # CONFIG_V1 — single source of truth for all tunable params
types.ts          # Player, Team, Skills, GameResult, AtBatRecord, …
rng.ts            # createRng(seed) — seedable mulberry32 PRNG
randomTeam.ts     # generateTeam(), generateMatchup()
agents.ts         # Pitcher + batter decision agents (2-strike foul boost)
atBat.ts          # Plate appearance resolution
battedBall.ts     # Physics-based batted ball outcome (exit velo, launch angle, distance)
game.ts           # Full game loop — half-innings, baserunner advancement, situational events
events.ts         # buildEvents() — derives SimEvent[] timeline from GameResult for 2D playback
report.ts         # aggregate() + formatReport() — rate-stat summary
manager.ts        # Lineup/rotation manager
index.ts          # Public entry point — all exports
physics/
  ballFlight.ts   # Drag + gravity ball flight model
  park.ts         # Park wall distances by spray angle
  speed.ts        # Runner speed model + base coordinates
  throw.ts        # Throw velocity and time model
```

### `apps/web/src/`

```
app/
├── (auth)/           # Login, signup, password reset
├── api/              # 9 API route groups
│   ├── challenges/   # O2O challenge send/respond/sim
│   ├── cron/         # Automated sim scheduling
│   ├── games/        # Game detail lookup
│   ├── market/       # Free agent sign/release
│   ├── payroll/      # Weekly salary deduction
│   ├── provision/    # Team creation + league fill
│   ├── sim/          # Game simulation (run, sim-all, status, reset)
│   ├── trades/       # List, offer, respond, withdraw
│   └── training/     # Assign slots, run daily training
├── auth/callback/    # Supabase OAuth callback
└── dashboard/        # 14 feature pages
    ├── roster/       # Team roster — 10 skills, Ht/Wt/Ctr, country flag
    ├── lineup/       # Batting order — position assignment, DH, B1/B2/B3 bench
    ├── rotation/     # Pitching rotation — SP1-5 + RP1-4
    ├── games/        # Game results and box scores
    ├── schedule/     # Season schedule
    ├── standings/    # League standings
    ├── leaders/      # Statistical leaders (10 categories)
    ├── stats/        # Detailed player statistics
    ├── finance/      # Budget and transaction history
    ├── market/       # Free agent signings
    ├── trades/       # Player trading system
    ├── training/     # Between-game skill development
    ├── challenges/   # One-on-one exhibition games
    └── notifications/# In-app notifications
lib/
├── sim-engine/       # Production sim engine (DB-wired, ~1,400 lines)
├── sim/              # DB orchestration — load rosters → engine → persist
├── finance/          # Safe debit/credit, transaction recording
├── lineup/           # Lineup backfill utility
├── trades/           # Trade proposal, execution, player valuation
├── training/         # Skill improvement system
├── notifications/    # In-app notification dispatch
├── provisioning/     # Team creation, AI fill, schedule generation
├── queries/          # Shared DB queries (getMyTeam, requireMyTeam)
├── seed/             # Player generation, schedule generation, 200+ names
└── supabase/         # Client helpers (browser, server, service-role)
```

### `apps/ios/`

```
app/
└── index.tsx         # Root screen — placeholder for Phase A build
app.json              # Expo config (slug, bundle ID, splash, icons)
tsconfig.json         # Extends expo/tsconfig.base
package.json          # Expo + react-native-skia + @baseballczar/sim-engine
```

## Root Scripts

```bash
npm run dev          # Start web dev server (kills port 3000 first)
npm run build        # Production build (web)
npm run test         # Vitest unit tests (apps/web)
npm run test:e2e     # Playwright E2E tests (apps/web)
npm run sim          # Sim-engine CLI — 162-game season
npm run skill-test   # Skill sensitivity harness
npm run typecheck    # TypeScript check (packages/sim-engine)
```

## Key Concepts

- **Provisioning:** Signup creates a team, fills 5 AI managers, generates a 150-game schedule (50 rounds × 3 games).
- **Simulation:** Pure TypeScript engine — no DB calls during sim. Results persisted via batch RPC upserts.
- **Sim Engine (package):** Physics-based, seedable, zero external runtime deps. Shared by web and iOS via npm workspaces.
- **Event Log:** `buildEvents(gameResult)` derives a timestamped `SimEvent[]` timeline (13 event types) ready for 2D rendering.
- **Lineup Backfill:** Releasing/trading a starter auto-promotes bench players.
- **Training:** Skills improve between sim days, bounded by player potential.
- **Finance:** Budget enforcement via PostgreSQL CHECK constraints + safe debit/credit RPC.

## Sim Engine CLI

```bash
# From repo root (delegates to packages/sim-engine):
npm run sim
npm run sim -- --games 50 --seed 1
npm run sim -- --verbose
npm run sim -- --pbp
npm run sim -- --events out.json

# Or directly from packages/sim-engine:
npx tsx scripts/sim-lab.ts --games 10 --seed 42
npx tsx scripts/skill-test.ts --games 30
```

## Sim Engine Configuration

All tunable knobs live in a single source of truth at
[packages/sim-engine/src/config.ts](packages/sim-engine/src/config.ts).
Edit a value, re-run `npm test` and `npm run sim`, and the change
propagates to every consumer (engine, renderer, CLI). Timing constants
that the event builder uses live alongside in
[packages/sim-engine/src/events/timing.ts](packages/sim-engine/src/events/timing.ts).

> **Calibration baseline (CONFIG_V1, 162 games @ seed 1):**
> BB% .085 · K% .251 · BABIP .322 · HR/FB .148 · 4.08 R/G · 1.22 fouls/PA.
> If you tweak a knob, re-run `npm run sim -- --games 162 --seed 1`
> and confirm the rates in `expectedRanges` still hold.

### `CONFIG.park` — field geometry (feet)

| Knob                            | Default | Effect when raised                     |
| ------------------------------- | ------- | -------------------------------------- |
| `leftLineFt`, `rightLineFt`     | 320     | Pull-side HRs harder                   |
| `leftCenterFt`, `rightCenterFt` | 375     | Gap doubles less likely to clear       |
| `centerFt`                      | 405     | CF HRs harder                          |
| `wallHeightFt`                  | 10      | Fewer HRs (anything ≤ wall is in play) |
| `foulTerritoryDepthFt`          | 60      | More foul-pop catches by OF            |

### `CONFIG.flight` — ball flight & rolls

| Knob                       | Default | Effect when raised                        |
| -------------------------- | ------- | ----------------------------------------- |
| `gravityFtPerSec2`         | 32.174  | Shorter hang times, less carry            |
| `dragCoeff`                | 0.0078  | Ball carries less — fewer HRs             |
| `mphToFps`                 | 1.467   | (unit constant — don't touch)             |
| `roll.bounceKeepFrac`      | 0.55    | Longer rollouts after first bounce        |
| `roll.grassDecelFtPerSec2` | 14      | Ball stops faster on grass                |
| `roll.wallBounceKeepFrac`  | 0.55    | Stronger ricochet off the wall            |
| `roll.pursuitIterations`   | 6       | More accurate intercept solve (cost: CPU) |

### `CONFIG.throwVeloBaseMph` — base throw velocity by position (mph)

| Knob                      | Default           | Effect when raised                      |
| ------------------------- | ----------------- | --------------------------------------- |
| `P` / `C`                 | 85 / 82           | Faster pickoff / CS times               |
| `B1` / `B2` / `SS` / `B3` | 80 / 82 / 86 / 84 | Quicker IF cross-diamond throws         |
| `LF` / `CF` / `RF`        | 86 / 88 / 88      | Tougher to take an extra base           |
| `outfieldCrowHopMph`      | 5                 | OF gets bonus on long throws            |
| `releaseTimeSec`          | 1.0               | Slower IF release (more SB/extra bases) |
| `outfieldReleaseTimeSec`  | 1.3               | Slower OF release (more extra bases)    |

### `CONFIG.runner` — sprint speeds (ft/sec)

| Knob                | Default | Effect when raised               |
| ------------------- | ------- | -------------------------------- |
| `minFtPerSec`       | 22      | Skill-1 runners faster           |
| `maxFtPerSec`       | 28      | Skill-10 runners faster          |
| `leftyHeadStartSec` | 0.3     | LHB legs out more infield hits   |
| `secondaryLeadFt`   | 12      | Easier to take an extra base     |
| `reactionToBatSec`  | 0.4     | Slower break — fewer extra bases |

### `CONFIG.fielder` — reaction & range

| Knob            | Default | Effect when raised        |
| --------------- | ------- | ------------------------- |
| `reactionSec`   | 0.3     | Slower start — more hits  |
| `rangeFtPerSec` | 32      | Wider range — fewer hits  |
| `catchRadiusFt` | 10      | Easier line-drive catches |

### `CONFIG.fielding` — converge / pickup / territory

| Knob                                          | Default  | Effect when raised                                    |
| --------------------------------------------- | -------- | ----------------------------------------------------- |
| `pickupSec`                                   | 0.4      | Slower glove transfer                                 |
| `groundBallFrictionMul`                       | 0.55     | Grounder reaches IF faster                            |
| `minRollSpeedFps`                             | 40       | Floor on weak choppers' arrival speed                 |
| `territoryPenaltySecPerDeg`                   | 0.012    | Stricter zone discipline                              |
| `shortBallRadiusFt`                           | 45       | Wider C/P pop-up territory                            |
| `infielderMaxNaturalDepthFt`                  | 160      | IF allowed deeper before penalty                      |
| `infielderDepthPenaltySecPerFt`               | 0.025    | Steeper IF-out-of-zone penalty                        |
| `chargeMul`                                   | 1.0      | Charging fielder range multiplier                     |
| `backpedalMul`                                | 0.6      | Backpedaling range — raise = better drop steps        |
| `naturalSprayAngleDeg.{LF,CF,RF,B3,SS,B2,B1}` | -31..+31 | Each fielder's home zone center                       |
| `cornerCaromAngleDeg`                         | 36       | Spray angle past which OF takes the carom penalty (°) |
| `cornerCaromPenaltySec`                       | 0.6      | Time penalty for OF retrieving balls down the lines   |
| `rangeDefenseLeverageFps`                     | 1.5      | Range bump per defense skill point above 5 (ft/s)     |
| `rangeSpeedLeverageFps`                       | 2.5      | Range bump per speed skill point above 5 (ft/s)       |
| `foulCatch.cornerDepthFt`                     | 55       | Corners chase fouls farther                           |
| `foulCatch.catcherDepthFt`                    | 80       | Catcher chases fouls farther                          |
| `foulCatch.catcherShortRadiusFt`              | 20       | Larger catcher-bias circle                            |
| `foulCatch.catcherShortBiasMul`               | 0.7      | Stronger catcher claim near home                      |
| `extraBaseSlackSec.toSecond`                  | 0.0      | Negative → more doubles (aggressive runner)           |
| `extraBaseSlackSec.toThird`                   | 0.0      | Negative → more triples (aggressive runner)           |

### `CONFIG.battedBall` — EV / LA / spray distributions

| Knob                          | Default  | Effect when raised                  |
| ----------------------------- | -------- | ----------------------------------- |
| `powerToExitVeloMph.min/max`  | 75 / 115 | Wider EV range across skill 1–10    |
| `dhrToLaunchAngleDeg.min/max` | -15 / 25 | Wider LA range across skill 1–10    |
| `launchAngleStdDevDeg`        | 12       | More LA variance per swing          |
| `exitVeloStdDevMph`           | 8        | More EV variance per swing          |
| `pullCenterDeg`               | 14       | Stronger pull tendency              |
| `sprayStdDevDeg`              | 18       | Wider spray (more oppo, more fouls) |

### `CONFIG.pitch` — per-pitch outcome rolls

| Knob                   | Default | Effect when raised                   |
| ---------------------- | ------- | ------------------------------------ |
| `baseInZoneRate`       | 0.50    | Pitchers throw more strikes          |
| `baseSwingInZoneRate`  | 0.72    | Hitters more aggressive in zone      |
| `baseChaseRate`        | 0.22    | Hitters chase more (fewer walks)     |
| `baseContactRate`      | 0.88    | Higher contact (fewer Ks)            |
| `foulRate`             | 0.45    | More fouls per contact (longer ABs)  |
| `twoStrikeFoulRetains` | true    | 2-strike fouls don't end ABs         |
| `maxPitchesPerAB`      | 20      | Safety cap on AB length              |
| `edgeIsStrikeProb`     | 0.36    | Umpires call more borderline strikes |
| `hbpProb`              | 0.005   | More HBPs                            |

### `CONFIG.errors` — fielding & throwing errors

| Knob                | Default | Effect when raised                         |
| ------------------- | ------- | ------------------------------------------ |
| `grounderErrorBase` | 0.030   | More booted grounders                      |
| `flyErrorBase`      | 0.008   | More dropped flies                         |
| `throwErrorBase`    | 0.012   | More throwing errors (extra-base advances) |
| `skillLeverage`     | 0.006   | Defense skill matters more (per pt off 5)  |

### `CONFIG.doublePlay` — turn rates

| Knob            | Default | Effect when raised                    |
| --------------- | ------- | ------------------------------------- |
| `baseProb`      | 0.42    | More DPs turned                       |
| `skillLeverage` | 0.04    | Glove skill matters more on the pivot |

### `CONFIG.baserunning` — situational rolls

| Knob            | Default | Effect when raised                           |
| --------------- | ------- | -------------------------------------------- |
| `sacFlyTagProb` | 0.85    | More R3-tags-on-fly conversions              |
| `fcProb`        | 0.50    | More forced-runner outs (vs. routine 1B-out) |

### `CONFIG.manager` — pitcher usage

| Knob                       | Default | Effect when raised                  |
| -------------------------- | ------- | ----------------------------------- |
| `starterMaxPitches`        | 100     | Starters go deeper                  |
| `starterTargetIp`          | 6       | Manager waits longer to pull        |
| `relieverMaxPitches`       | 25      | Relievers stretch more              |
| `bullpenWarningPitches`    | 90      | Bullpen warms later                 |
| `pinchHitPlatoonAdvantage` | true    | Manager pinch-hits for platoon edge |

### `CONFIG.game` — roster & game length

| Knob           | Default | Effect when raised             |
| -------------- | ------- | ------------------------------ |
| `maxInnings`   | 18      | Longer extra-inning safety cap |
| `rosterSize`   | 25      | Larger roster                  |
| `lineupSize`   | 9       | Lineup positions               |
| `rotationSize` | 5       | More starting pitchers         |
| `bullpenSize`  | 7       | Larger bullpen                 |

### `CONFIG.expectedRanges` — calibration guardrails

Acceptance bands the CLI prints in green/red after a 162-game sim.
Tighten or widen these to flag when a tweak takes a rate out of MLB range.

| Knob             | Default range  | What it checks               |
| ---------------- | -------------- | ---------------------------- |
| `bbPct`          | [0.07, 0.11]   | Walk rate                    |
| `kPct`           | [0.18, 0.26]   | Strikeout rate               |
| `babip`          | [0.290, 0.310] | BA on balls in play          |
| `hrPerFb`        | [0.10, 0.14]   | HR per fly ball              |
| `pitchesPerPa`   | [3.6, 4.0]     | Pitches per plate appearance |
| `pitchesPerGame` | [135, 160]     | Per-team pitch count         |
| `runsPerGame`    | [3.5, 5.5]     | Per-team scoring             |
| `foulsPerPa`     | [1.2, 1.8]     | Foul-ball density            |

### `TIME` — event-builder timing constants

[packages/sim-engine/src/events/timing.ts](packages/sim-engine/src/events/timing.ts).
These don't change rate stats — they only change how long the renderer
plays each beat. Tweak for a snappier or more leisurely PBP playback.

| Knob                       | Default | What it controls                  |
| -------------------------- | ------- | --------------------------------- |
| `pitchToHomeSec`           | 0.45    | Pitch flight time                 |
| `betweenPitchesSec`        | 12      | Pause between pitches             |
| `betweenAtBatsSec`         | 25      | Pause between at-bats             |
| `betweenInningsSec`        | 120     | Pause between innings             |
| `preGameSec`               | 15      | Pre-first-pitch delay             |
| `runnerReactionSec`        | 0.4     | Runner break after contact        |
| `perBaseSec`               | 3.5     | Base-to-base running time         |
| `catcherHoldSec`           | 0.5     | Catcher pause before lob to P     |
| `fielderHoldSec`           | 0.7     | Fielder pause before return throw |
| `umpireHoldSec`            | 1.5     | Umpire ball-replacement delay     |
| `ballReturnSlowFtPerSec`   | 75      | Catcher lob speed                 |
| `ballReturnNormalFtPerSec` | 110     | Fielder return throw speed        |

## Database Migrations

Seven migrations applied in order:

1. **001** — Initial schema (20 tables, RLS policies, indexes)
2. **002** — Seed 100 first/last names for player generation
3. **003** — Add ERA tracking columns to standings
4. **004** — Safe debit constraints, batch upsert RPC functions
5. **005** — Expand name pool + UNIQUE constraint on row_num
6. **006** — Expand name pool to 200+ entries
7. **007** — Add `country_id` column to players (default 1 = USA)

Apply all: `npx supabase db push`

## Testing

```bash
# Unit tests — 7 files, 60 assertions
npm run test

# E2E
npm run test:e2e

# Sim smoke tests (from apps/web/)
cd apps/web && npx tsx tests/seed-smoke-test.ts
cd apps/web && npx tsx tests/smoke-test.ts
```

## Deployment

- **Web:** Vercel. Set `Root Directory: apps/web` in the Vercel project dashboard.
- **iOS:** Expo EAS Build. Run `eas build --platform ios` from `apps/ios/`. Add your EAS project ID to `apps/ios/app.json`.

## UI Highlights

- **Roster page** — All 10 player skills, TOT column, Ht/Wt/Ctr demographics, country flag SVG
- **Lineup page** — Position dropdown per slot (C/1B/2B/3B/SS/LF/CF/RF/DH); bench labeled B1/B2/B3; drag-to-reorder; bench↔starter swap
- **Rotation page** — Three skill tables (SP1–5, RP1–4, Available); drag-to-reorder; assign buttons
- **Stats page** — Hitting (r/h/b2/b3) and pitching (ip/h/r/er/bb/so) columns fixed

## Improvement Plan Status

All 18 items from the original P0–P3 improvement plan have been implemented:

- **P0 (Critical):** Auth on all sim routes, budget transaction safety, rate limiting ✅
- **P1 (High):** Batch SQL upserts, DB constraints, standings fix ✅
- **P2 (Medium):** Vitest suite (60 tests), structured logging (Pino), cron sim, security headers, named constants ✅
- **P3 (Backlog):** Playwright E2E, CI/CD, Sentry monitoring, response caching, 200+ name pool, persist-game split ✅

## Code Review

- [BBZAR_MASTER_REVIEW.md](BBZAR_MASTER_REVIEW.md) — Master hub with severity matrix
- [issues.md](issues.md) — Open bugs and known sim/render issues
- [task.md](task.md) — Active task list (P0–P3 backlog)
- [review/01-correctness-logic.md](review/01-correctness-logic.md)
- [review/02-security.md](review/02-security.md)
- [review/03-architecture-design.md](review/03-architecture-design.md)
- [review/04-data-integrity.md](review/04-data-integrity.md)
- [review/05-error-handling.md](review/05-error-handling.md)
- [review/06-performance.md](review/06-performance.md)
- [review/07-readability-maintainability.md](review/07-readability-maintainability.md)
- [review/08-testing.md](review/08-testing.md)
- [review/09-improvement-plan.md](review/09-improvement-plan.md)
- [IOS_STRATEGY.md](IOS_STRATEGY.md) — iOS product strategy and 5-phase build plan
